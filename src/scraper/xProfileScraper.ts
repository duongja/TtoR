import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";

import type { AppConfig } from "../config.js";
import { ScraperError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { BackfillResult, NormalizedPost, ScrapeResult, TimelineScraper } from "../types.js";
import { parseTimelineHtml } from "./parseTimelineHtml.js";
import { parseUserTweetsResponse } from "./parseUserTweetsResponse.js";

function timestampLabel(now = new Date()): string {
  return now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export class XProfileScraper implements TimelineScraper {
  private context: BrowserContext | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  public async openInteractiveSession(handle: string): Promise<Page> {
    await this.ensureContext(false);
    const page = await this.context!.newPage();
    await page.goto("https://x.com/i/flow/login", {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    return page;
  }

  public async scrapeTimeline(handle: string): Promise<ScrapeResult> {
    await this.ensureContext(this.config.headless);

    const page = await this.getPage();
    const sourceUrl = `https://x.com/${handle}`;
    const extractedAt = new Date().toISOString();
    const artifactPaths: string[] = [];
    const userTweetsPayloads: unknown[] = [];

    const onResponse = async (response: Response): Promise<void> => {
      const url = response.url();
      if (!url.includes("/i/api/graphql/")) {
        return;
      }

      try {
        userTweetsPayloads.push(await response.json());
      } catch (error) {
        this.logger.warn("Failed to parse UserTweets response", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    page.on("response", onResponse);

    try {
      await page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    } catch (error) {
      throw new ScraperError("NAVIGATION_FAILED", "Failed to load X profile", {
        cause: error instanceof Error ? error.message : String(error)
      });
    } finally {
      page.off("response", onResponse);
    }

    if (await this.isLoginRequired(page)) {
      const rawHtml = await page.content();
      artifactPaths.push(...(await this.captureArtifacts(page, "login-required", rawHtml)));

      return {
        posts: [],
        loginExpired: true,
        extractedAt,
        sourceUrl,
        rawHtml,
        artifactPaths
      };
    }

    try {
      await page.waitForSelector("article, a[href*='/status/']", {
        timeout: 15_000
      });
    } catch {
      const rawHtml = await page.content();
      artifactPaths.push(...(await this.captureArtifacts(page, "timeline-missing", rawHtml)));
      throw new ScraperError("TIMELINE_NOT_FOUND", "No timeline elements were found on the profile page", {
        artifactPaths
      });
    }

    const rawHtml = await page.content();

    const networkPosts = userTweetsPayloads.flatMap((payload) =>
      parseUserTweetsResponse(payload, {
        expectedHandle: handle,
        detectedAt: extractedAt
      })
    );
    if (networkPosts.length > 0) {
      return {
        posts: networkPosts,
        loginExpired: false,
        extractedAt,
        sourceUrl,
        rawHtml,
        artifactPaths
      };
    }

    try {
      const posts = parseTimelineHtml(rawHtml, {
        expectedHandle: handle,
        detectedAt: extractedAt
      });

      return {
        posts,
        loginExpired: false,
        extractedAt,
        sourceUrl,
        rawHtml,
        artifactPaths
      };
    } catch (error) {
      artifactPaths.push(...(await this.captureArtifacts(page, "parse-failed", rawHtml)));

      if (error instanceof ScraperError) {
        throw new ScraperError(error.code, error.message, {
          ...(error.details ?? {}),
          artifactPaths
        });
      }

      throw new ScraperError("PARSE_FAILED", "Failed to parse timeline HTML", {
        artifactPaths
      });
    }
  }

  public async backfillTimeline(
    handle: string,
    options: { since: Date; maxScrolls?: number }
  ): Promise<BackfillResult> {
    await this.ensureContext(this.config.headless);

    if (!this.context) {
      throw new Error("Browser context has not been initialized");
    }

    const page = await this.context.newPage();
    const startedAt = new Date().toISOString();
    const detectedAt = startedAt;
    const maxScrolls = options.maxScrolls ?? 500;
    const sourceUrl = `https://x.com/${handle}`;
    const posts = new Map<string, NormalizedPost>();
    const inRangePostIds = new Set<string>();
    const olderThanCutoffPostIds = new Set<string>();
    const capturedPayloads = new Set<string>();
    let pagesCaptured = 0;
    let scrolls = 0;
    let staleScrolls = 0;
    let staleInRangeScrolls = 0;
    let stoppedReason: BackfillResult["stoppedReason"] = "max_scrolls";

    const processPayload = (payload: unknown, source: string): { newPostCount: number; newInRangePostCount: number } => {
      const fingerprint = JSON.stringify(payload);
      if (capturedPayloads.has(fingerprint)) {
        return {
          newPostCount: 0,
          newInRangePostCount: 0
        };
      }

      capturedPayloads.add(fingerprint);
      pagesCaptured += 1;

      const parsed = parseUserTweetsResponse(payload, {
        expectedHandle: handle,
        detectedAt
      });

      this.logger.debug("Parsed timeline response during backfill", {
        source,
        parsedPostCount: parsed.length
      });

      const before = posts.size;
      const beforeInRange = inRangePostIds.size;
      for (const post of parsed) {
        posts.set(post.postId, post);

        if (!post.createdAt || new Date(post.createdAt).getTime() >= options.since.getTime()) {
          inRangePostIds.add(post.postId);
        } else {
          olderThanCutoffPostIds.add(post.postId);
        }
      }

      return {
        newPostCount: posts.size - before,
        newInRangePostCount: inRangePostIds.size - beforeInRange
      };
    };

    const processResponse = async (
      response: Response | null,
      source: string
    ): Promise<{ newPostCount: number; newInRangePostCount: number; captured: boolean }> => {
      if (!response) {
        return {
          newPostCount: 0,
          newInRangePostCount: 0,
          captured: false
        };
      }

      try {
        const result = processPayload(await response.json(), source);
        return {
          ...result,
          captured: true
        };
      } catch (error) {
        this.logger.warn("Failed to parse timeline response during backfill", {
          source,
          error: error instanceof Error ? error.message : String(error)
        });

        return {
          newPostCount: 0,
          newInRangePostCount: 0,
          captured: false
        };
      }
    };

    try {
      const firstTimelineResponse = page
        .waitForResponse((response) => response.url().includes("/UserTweets?"), {
          timeout: 30_000
        })
        .catch(() => null);

      await page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);

      if (await this.isLoginRequired(page)) {
        throw new ScraperError("LOGIN_REQUIRED", "Stored X session is not logged in");
      }

      const initialResult = await processResponse(await firstTimelineResponse, "profile");
      if (!initialResult.captured) {
        stoppedReason = "request_failed";
      } else {
        while (scrolls < maxScrolls) {
          const nextTimelineResponse = page
            .waitForResponse((response) => response.url().includes("/UserTweets?"), {
              timeout: 10_000
            })
            .catch(() => null);

          await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 2);
          });
          await page.waitForTimeout(1_500);
          const result = await processResponse(await nextTimelineResponse, "profile");
          scrolls += 1;

          if (!result.captured || result.newPostCount === 0) {
            staleScrolls += 1;
          } else {
            staleScrolls = 0;
          }

          if (result.newInRangePostCount === 0) {
            staleInRangeScrolls += 1;
          } else {
            staleInRangeScrolls = 0;
          }

          if (olderThanCutoffPostIds.size > 0 && staleInRangeScrolls >= 5) {
            stoppedReason = "reached_since";
            break;
          }

          if (staleScrolls >= 8) {
            stoppedReason = "no_progress";
            break;
          }
        }

        if (scrolls >= maxScrolls) {
          stoppedReason = "max_scrolls";
        }
      }

      const filteredPosts = [...posts.values()]
        .filter((post) => {
          if (!post.createdAt) {
            return true;
          }

          return new Date(post.createdAt).getTime() >= options.since.getTime();
        })
        .sort(comparePostsDescending);

      return {
        posts: filteredPosts,
        startedAt,
        finishedAt: new Date().toISOString(),
        sourceUrl,
        since: options.since.toISOString(),
        pagesCaptured,
        scrolls,
        oldestPostAt: filteredPosts.at(-1)?.createdAt ?? null,
        newestPostAt: filteredPosts[0]?.createdAt ?? null,
        stoppedReason
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  public async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
  }

  private async ensureContext(headless: boolean): Promise<void> {
    if (this.context) {
      return;
    }

    this.context = await chromium.launchPersistentContext(this.config.browserUserDataDir, {
      channel: this.config.browserChannel === "chrome" ? "chrome" : undefined,
      headless,
      viewport: headless
        ? {
            width: 1440,
            height: 1200
          }
        : null,
      args: headless ? [] : ["--start-maximized"]
    });
  }

  private async getPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("Browser context has not been initialized");
    }

    const existingPage = this.context.pages()[0];
    if (existingPage) {
      return existingPage;
    }

    return this.context.newPage();
  }

  private async isLoginRequired(page: Page): Promise<boolean> {
    const currentUrl = page.url().toLowerCase();
    if (currentUrl.includes("/login") || currentUrl.includes("/i/flow/login")) {
      return true;
    }

    const bodyText = (await page.textContent("body").catch(() => ""))?.toLowerCase() ?? "";
    if (
      bodyText.includes("sign in to x") ||
      bodyText.includes("log in to x") ||
      bodyText.includes("join x today")
    ) {
      return true;
    }

    const cookies = await page.context().cookies();
    return !cookies.some((cookie) => cookie.name === "auth_token");
  }

  private async captureArtifacts(page: Page, label: string, rawHtml: string): Promise<string[]> {
    const basename = `${timestampLabel()}-${label}`;
    const screenshotPath = resolve(this.config.artifactsDir, `${basename}.png`);
    const htmlPath = resolve(this.config.artifactsDir, `${basename}.html`);

    await Promise.all([
      page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
        this.logger.warn("Failed to capture screenshot artifact", {
          label,
          error: error instanceof Error ? error.message : String(error)
        });
      }),
      fs.writeFile(htmlPath, rawHtml, "utf8")
    ]);

    return [screenshotPath, htmlPath];
  }
}

function comparePostsDescending(left: NormalizedPost, right: NormalizedPost): number {
  const leftDate = left.createdAt ? Date.parse(left.createdAt) : 0;
  const rightDate = right.createdAt ? Date.parse(right.createdAt) : 0;

  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }

  return right.postId.localeCompare(left.postId);
}
