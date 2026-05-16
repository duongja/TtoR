import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { startApiServer } from "./api.js";
import { ensureRuntimeDirs, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { XProfileScraper } from "./scraper/xProfileScraper.js";
import { Repository } from "./storage.js";
import { PollingWorker } from "./worker.js";

function printUsage(): void {
  console.log(`Usage:
  npm run login
  npm run backfill
  npm run poll-once
  npm run worker
  npm run api
  npm run serve`);
}

async function runLoginCommand(): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirs(config);
  const logger = createLogger(config.logLevel);
  const scraper = new XProfileScraper(config, logger);

  try {
    await scraper.openInteractiveSession(config.targetHandle);

    const rl = createInterface({ input, output });
    await rl.question(
      `Complete native X login in the opened browser window for @${config.targetHandle} using X username/email + password (not "Sign in with Google"), then press Enter here to verify the session. `
    );
    rl.close();

    const result = await scraper.scrapeTimeline(config.targetHandle);
    if (result.loginExpired) {
      throw new Error("Login verification failed. The stored browser profile is still logged out.");
    }

    logger.info("Login session verified", {
      detectedPosts: result.posts.length,
      sourceUrl: result.sourceUrl
    });
  } finally {
    await scraper.close();
  }
}

async function runPollOnceCommand(): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirs(config);
  const logger = createLogger(config.logLevel);
  const repository = Repository.open(config.databasePath);
  const scraper = new XProfileScraper(config, logger);
  const worker = new PollingWorker(config, repository, scraper, logger);

  try {
    const summary = await worker.runCycle();
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await scraper.close();
    await repository.close();
  }
}

function parseBackfillSince(raw: string | undefined): Date {
  const fallback = "2026-01-01T00:00:00.000Z";
  const value = raw ?? process.env.BACKFILL_SINCE ?? fallback;
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid backfill cutoff "${value}". Use an ISO date like ${fallback}.`);
  }

  return parsed;
}

async function runBackfillCommand(): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirs(config);
  const logger = createLogger(config.logLevel);
  const repository = Repository.open(config.databasePath);
  const scraper = new XProfileScraper(config, logger);
  const since = parseBackfillSince(process.argv[3]);
  const startedAt = new Date().toISOString();

  try {
    const result = await scraper.backfillTimeline(config.targetHandle, {
      since
    });
    const finishedAt = new Date().toISOString();
    const saved = await repository.recordPollRun({
      startedAt,
      finishedAt,
      status: "success",
      posts: result.posts,
      metadata: {
        mode: "backfill",
        sourceUrl: result.sourceUrl,
        backfillStartedAt: result.startedAt,
        backfillFinishedAt: result.finishedAt,
        since: result.since,
        pagesCaptured: result.pagesCaptured,
        scrolls: result.scrolls,
        scrapedPostCount: result.posts.length,
        oldestPostAt: result.oldestPostAt,
        newestPostAt: result.newestPostAt,
        stoppedReason: result.stoppedReason
      }
    });

    console.log(
      JSON.stringify(
        {
          status: "success",
          since: result.since,
          scrapedPostCount: result.posts.length,
          newPostsCount: saved.newPostsCount,
          latestPostId: saved.latestPostId,
          pagesCaptured: result.pagesCaptured,
          scrolls: result.scrolls,
          oldestPostAt: result.oldestPostAt,
          newestPostAt: result.newestPostAt,
          stoppedReason: result.stoppedReason
        },
        null,
        2
      )
    );
  } finally {
    await scraper.close();
    await repository.close();
  }
}

async function runWorkerCommand(withApi: boolean): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirs(config);
  const logger = createLogger(config.logLevel);
  const repository = Repository.open(config.databasePath);
  const scraper = new XProfileScraper(config, logger);
  const worker = new PollingWorker(config, repository, scraper, logger);
  const apiServer = withApi ? await startApiServer(repository, config, logger) : null;

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down services");
    worker.stop();
    apiServer?.close();
    await scraper.close();
    await repository.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  try {
    await worker.start();
  } finally {
    await shutdown();
  }
}

async function runApiCommand(): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirs(config);
  const logger = createLogger(config.logLevel);
  const repository = Repository.open(config.databasePath);
  const server = await startApiServer(repository, config, logger);

  const shutdown = (): void => {
    logger.info("Stopping API server");
    server.close();
    void repository.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "login":
      await runLoginCommand();
      break;
    case "backfill":
      await runBackfillCommand();
      break;
    case "poll-once":
      await runPollOnceCommand();
      break;
    case "worker":
      await runWorkerCommand(false);
      break;
    case "serve":
      await runWorkerCommand(true);
      break;
    case "api":
      await runApiCommand();
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
