import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { Repository } from "./storage.js";
import type { ScrapeResult, TimelineScraper } from "./types.js";
import { PollingWorker, computeNextDelayMs } from "./worker.js";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function buildConfig(): AppConfig {
  return {
    targetHandle: "polymarket",
    pollIntervalSeconds: 60,
    pollJitterSeconds: 15,
    dataDir: "/tmp/data",
    databasePath: ":memory:",
    databaseUrl: "sqlite::memory:",
    browserUserDataDir: "/tmp/profile",
    artifactsDir: "/tmp/artifacts",
    headless: true,
    logLevel: "info",
    apiHost: "127.0.0.1",
    apiPort: 8787,
    browserChannel: "chrome",
    cronSecret: null,
    xAuthToken: null,
    xCsrfToken: null,
    xGuestToken: null,
    xBearerToken: null,
    xUserTweetsUrl: null,
    xCookieHeader: null
  };
}

function createScraper(result: ScrapeResult): TimelineScraper {
  return {
    scrapeTimeline: vi.fn(async () => result),
    close: vi.fn(async () => undefined)
  };
}

describe("computeNextDelayMs", () => {
  it("adds jitter and caps backoff", () => {
    expect(computeNextDelayMs(60, 15, 0, 0.5)).toBe(67_500);
    expect(computeNextDelayMs(60, 15, 4, 0)).toBe(300_000);
  });
});

describe("PollingWorker", () => {
  it("records successful polls and resets failures", async () => {
    const repository = Repository.open(":memory:");
    const config = buildConfig();
    const scraper = createScraper({
      posts: [
        {
          postId: "10",
          authorHandle: "polymarket",
          authorDisplayName: "Polymarket",
          createdAt: "2026-05-15T10:00:00.000Z",
          detectedAt: "2026-05-15T10:00:05.000Z",
          text: "Test",
          lang: "en",
          conversationId: "10",
          replyToPostId: null,
          quotedPostId: null,
          isRepost: false,
          media: [],
          rawPayload: {}
        }
      ],
      loginExpired: false,
      extractedAt: "2026-05-15T10:00:05.000Z",
      sourceUrl: "https://x.com/polymarket",
      rawHtml: "<html></html>",
      artifactPaths: []
    });
    const nowValues = [
      new Date("2026-05-15T10:00:00.000Z"),
      new Date("2026-05-15T10:00:05.000Z")
    ];
    const worker = new PollingWorker(
      config,
      repository,
      scraper,
      silentLogger,
      () => nowValues.shift() ?? new Date("2026-05-15T10:00:05.000Z"),
      () => 0
    );

    const summary = await worker.runCycle();

    expect(summary).toMatchObject({
      status: "success",
      newPostsCount: 1,
      latestPostId: "10",
      errorCode: null
    });
    expect(repository.getLatestPoll()?.status).toBe("success");

    repository.close();
  });

  it("records login-required failures", async () => {
    const repository = Repository.open(":memory:");
    const config = buildConfig();
    const scraper = createScraper({
      posts: [],
      loginExpired: true,
      extractedAt: "2026-05-15T10:00:05.000Z",
      sourceUrl: "https://x.com/polymarket",
      rawHtml: "<html></html>",
      artifactPaths: ["/tmp/login.html"]
    });
    const nowValues = [
      new Date("2026-05-15T10:00:00.000Z"),
      new Date("2026-05-15T10:00:05.000Z")
    ];
    const worker = new PollingWorker(
      config,
      repository,
      scraper,
      silentLogger,
      () => nowValues.shift() ?? new Date("2026-05-15T10:00:05.000Z"),
      () => 0
    );

    const summary = await worker.runCycle();

    expect(summary).toMatchObject({
      status: "error",
      errorCode: "LOGIN_REQUIRED"
    });
    expect(repository.getLatestPoll()?.errorCode).toBe("LOGIN_REQUIRED");
    await expect(repository.getHealthSnapshot(config)).resolves.toMatchObject({
      status: "unhealthy"
    });

    repository.close();
  });
});
