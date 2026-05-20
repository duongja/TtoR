import { describe, expect, it, vi } from "vitest";

import type { MemeSignalService } from "./ai/memeSignalService.js";
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
    xCookieHeader: null,
    xClientTransactionId: null,
    xUserAgent: null,
    aiEnabled: false,
    openaiApiKey: null,
    openaiBaseUrl: null,
    openaiModel: "gpt-5.4",
    openaiReasoningEffort: "medium",
    openaiStoreResponses: false,
    openaiTimeoutMs: 30_000,
    aiMaxPostsPerPoll: 1,
    memeSignalThreshold: 70,
    dexDiscoveryEnabled: false,
    dexDiscoveryMinSignalScore: 70,
    dexDiscoveryMaxSignalsPerRun: 5,
    dexDiscoveryMaxQueriesPerSignal: 8,
    dexDiscoveryCacheTtlMinutes: 30,
    dexCandidateRefreshTtlMinutes: 10,
    dexCandidateRefreshLimit: 100,
    dexRugCheckTtlMinutes: 10,
    dexRugCheckLimit: 100,
    solanaRpcUrl: "https://api.mainnet-beta.solana.com",
    dexDiscoveryMinLiquidityUsd: 5000,
    dexDiscoveryMinVolume24hUsd: 1000,
    dexScreenerBaseUrl: "https://api.dexscreener.com"
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
      null,
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
      null,
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

  it("runs optional meme signal analysis after successful polls", async () => {
    const repository = Repository.open(":memory:");
    const config = buildConfig();
    const scraper = createScraper({
      posts: [
        {
          postId: "20",
          authorHandle: "polymarket",
          authorDisplayName: "Polymarket",
          createdAt: "2026-05-15T10:00:00.000Z",
          detectedAt: "2026-05-15T10:00:05.000Z",
          text: "Concrete skull recovered",
          lang: "en",
          conversationId: "20",
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
    const memeSignalService = {
      analyzePendingPosts: vi.fn(async () => ({
        analyzedCount: 1,
        signalCount: 1,
        errorCount: 0
      }))
    } as unknown as MemeSignalService;
    const worker = new PollingWorker(config, repository, scraper, silentLogger, memeSignalService, () => new Date());

    await expect(worker.runCycle()).resolves.toMatchObject({
      status: "success",
      aiAnalyzedCount: 1,
      aiSignalCount: 1,
      aiErrorCount: 0
    });
    expect(memeSignalService.analyzePendingPosts).toHaveBeenCalledOnce();

    repository.close();
  });
});
