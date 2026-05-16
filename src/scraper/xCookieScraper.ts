import { ScraperError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { ScrapeResult, TimelineScraper } from "../types.js";
import { parseUserTweetsResponse } from "./parseUserTweetsResponse.js";

interface XCookieScraperOptions {
  authToken?: string;
  ct0?: string;
  cookieHeader?: string;
  guestToken?: string;
  bearerToken?: string;
  userTweetsUrl?: string;
}

const defaultBearerToken =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOZDgxXBXgDO4N7rP0%3D" +
  "q4poXjG0bF2R8G6R4rxM8cW4Z1c5O8K4lN7q9l2g";

function findUserTimelineUrl(html: string): string | null {
  const matches = html.matchAll(/https:\/\/x\.com\/i\/api\/graphql\/[^"'\\]+\/UserTweets\?[^"'\\]+/g);

  for (const match of matches) {
    return match[0].replaceAll("\\u0026", "&");
  }

  return null;
}

export class XCookieScraper implements TimelineScraper {
  public constructor(
    private readonly options: XCookieScraperOptions,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public async scrapeTimeline(handle: string): Promise<ScrapeResult> {
    const extractedAt = new Date().toISOString();
    const sourceUrl = `https://x.com/${handle}`;
    const rawHtml = this.options.userTweetsUrl ? "" : await this.fetchProfileHtml(sourceUrl);
    const userTweetsUrl = this.options.userTweetsUrl ?? findUserTimelineUrl(rawHtml);
    if (!userTweetsUrl) {
      throw new ScraperError("TIMELINE_NOT_FOUND", "Could not find UserTweets endpoint in X profile HTML");
    }

    const timelineResponse = await this.fetchImpl(userTweetsUrl, {
      headers: this.headers(sourceUrl)
    });

    if (timelineResponse.status === 401 || timelineResponse.status === 403) {
      return {
        posts: [],
        loginExpired: true,
        extractedAt,
        sourceUrl,
        rawHtml,
        artifactPaths: []
      };
    }

    if (!timelineResponse.ok) {
      throw new ScraperError("NAVIGATION_FAILED", "X UserTweets request failed", {
        status: timelineResponse.status
      });
    }

    const payload = await timelineResponse.json();
    const posts = parseUserTweetsResponse(payload, {
      expectedHandle: handle,
      detectedAt: extractedAt
    });

    this.logger.debug("Cookie scraper parsed UserTweets response", {
      parsedPostCount: posts.length
    });

    return {
      posts,
      loginExpired: false,
      extractedAt,
      sourceUrl,
      rawHtml,
      artifactPaths: []
    };
  }

  public async close(): Promise<void> {
    return undefined;
  }

  private async fetchProfileHtml(sourceUrl: string): Promise<string> {
    const profileResponse = await this.fetchImpl(sourceUrl, {
      headers: this.headers(sourceUrl)
    });
    const rawHtml = await profileResponse.text();

    if (profileResponse.status === 401 || profileResponse.status === 403) {
      throw new ScraperError("LOGIN_REQUIRED", "X profile request rejected authenticated cookies");
    }

    return rawHtml;
  }

  private headers(referer: string): HeadersInit {
    const cookie = this.options.cookieHeader ?? this.buildCookieHeader();

    return {
      accept: "*/*",
      authorization: `Bearer ${this.options.bearerToken ?? defaultBearerToken}`,
      cookie,
      referer,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "x-csrf-token": this.options.ct0 ?? this.extractCookieValue(cookie, "ct0") ?? "",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en"
    };
  }

  private buildCookieHeader(): string {
    const cookies: string[] = [];
    if (this.options.authToken) {
      cookies.push(`auth_token=${this.options.authToken}`);
    }
    if (this.options.ct0) {
      cookies.push(`ct0=${this.options.ct0}`);
    }
    if (this.options.guestToken) {
      cookies.push(`gt=${this.options.guestToken}`);
    }

    return cookies.join("; ");
  }

  private extractCookieValue(cookieHeader: string, name: string): string | null {
    for (const part of cookieHeader.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName === name) {
        return rawValue.join("=");
      }
    }

    return null;
  }
}
