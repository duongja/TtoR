import type { AppConfig } from "./config.js";
import { classifyError } from "./errors.js";
import type { Logger } from "./logger.js";
import { Repository } from "./storage.js";
import type { PollCycleSummary, TimelineScraper } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function computeNextDelayMs(
  intervalSeconds: number,
  jitterSeconds: number,
  consecutiveFailures: number,
  randomValue: number
): number {
  const baseMs = intervalSeconds * 1000;
  const jitterMs = Math.floor(Math.max(0, randomValue) * jitterSeconds * 1000);
  const multiplier = consecutiveFailures <= 0 ? 1 : Math.min(2 ** consecutiveFailures, 5);
  const delayMs = Math.min(baseMs * multiplier, 5 * 60 * 1000);
  return delayMs + jitterMs;
}

export class PollingWorker {
  private consecutiveFailures = 0;
  private running = false;
  private stopping = false;

  public constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly scraper: TimelineScraper,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = () => Math.random(),
    private readonly sleeper: (ms: number) => Promise<void> = sleep
  ) {}

  public async runCycle(): Promise<PollCycleSummary> {
    if (this.running) {
      throw new Error("Polling cycle is already running");
    }

    this.running = true;
    const startedAt = this.now().toISOString();

    try {
      const result = await this.scraper.scrapeTimeline(this.config.targetHandle);
      const finishedAt = this.now().toISOString();

      if (result.loginExpired) {
        this.repository.recordPollRun({
          startedAt,
          finishedAt,
          status: "error",
          errorCode: "LOGIN_REQUIRED",
          errorMessage: "Stored X session is not logged in",
          metadata: {
            sourceUrl: result.sourceUrl,
            extractedAt: result.extractedAt,
            artifactPaths: result.artifactPaths
          }
        });

        this.consecutiveFailures += 1;
        this.logger.warn("Polling cycle detected an expired login session");

        return {
          startedAt,
          finishedAt,
          status: "error",
          newPostsCount: 0,
          latestPostId: this.repository.getLatestPost()?.postId ?? null,
          errorCode: "LOGIN_REQUIRED"
        };
      }

      const saved = this.repository.recordPollRun({
        startedAt,
        finishedAt,
        status: "success",
        posts: result.posts,
        metadata: {
          sourceUrl: result.sourceUrl,
          extractedAt: result.extractedAt,
          artifactPaths: result.artifactPaths,
          scrapedPostCount: result.posts.length
        }
      });

      this.consecutiveFailures = 0;
      this.logger.info("Polling cycle completed", {
        newPostsCount: saved.newPostsCount,
        latestPostId: saved.latestPostId
      });

      return {
        startedAt,
        finishedAt,
        status: "success",
        newPostsCount: saved.newPostsCount,
        latestPostId: saved.latestPostId,
        errorCode: null
      };
    } catch (error) {
      const finishedAt = this.now().toISOString();
      const classified = classifyError(error);

      this.repository.recordPollRun({
        startedAt,
        finishedAt,
        status: "error",
        errorCode: classified.code,
        errorMessage: classified.message,
        metadata: error instanceof Error && "details" in error ? { details: (error as { details?: unknown }).details } : {}
      });

      this.consecutiveFailures += 1;
      this.logger.error("Polling cycle failed", {
        errorCode: classified.code,
        message: classified.message
      });

      return {
        startedAt,
        finishedAt,
        status: "error",
        newPostsCount: 0,
        latestPostId: this.repository.getLatestPost()?.postId ?? null,
        errorCode: classified.code
      };
    } finally {
      this.running = false;
    }
  }

  public async start(): Promise<void> {
    while (!this.stopping) {
      await this.runCycle();

      if (this.stopping) {
        break;
      }

      const delayMs = computeNextDelayMs(
        this.config.pollIntervalSeconds,
        this.config.pollJitterSeconds,
        this.consecutiveFailures,
        this.random()
      );

      this.logger.debug("Sleeping before next polling cycle", {
        delayMs,
        consecutiveFailures: this.consecutiveFailures
      });

      await this.sleeper(delayMs);
    }
  }

  public stop(): void {
    this.stopping = true;
  }
}
