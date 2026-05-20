import { loadConfig, type AppConfig } from "./config.js";
import { MemeSignalService } from "./ai/memeSignalService.js";
import { OpenAIMemeSignalAnalyzer } from "./ai/memeSignalAnalyzer.js";
import { DexDiscoveryService } from "./dex/discoveryService.js";
import { HttpDexScreenerClient } from "./dex/dexScreenerClient.js";
import { CompositeFreeTokenSecurityChecker, SolanaFreeTokenSecurityChecker } from "./dex/freeSecurityChecks.js";
import { createLogger } from "./logger.js";
import { PostgresRepository } from "./postgresRepository.js";
import type { PostRepository } from "./repository.js";
import { XCookieScraper } from "./scraper/xCookieScraper.js";
import type { TimelineScraper } from "./types.js";

export function loadVercelConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return loadConfig(env);
}

export function loadVercelPollingConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = loadConfig(env);

  if (!config.xCookieHeader && (!config.xAuthToken || !config.xCsrfToken)) {
    throw new Error("X_COOKIE_HEADER or both X_AUTH_TOKEN and X_CSRF_TOKEN are required for Vercel monitoring");
  }
  if (config.aiEnabled && !config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_ENABLED=true");
  }

  return config;
}

export function createVercelReadRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  repository: PostRepository;
} {
  const config = loadVercelConfig(env);

  return {
    config,
    repository: PostgresRepository.fromEnv(env)
  };
}

export function createMemeSignalService(
  config: AppConfig,
  repository: PostRepository,
  logger = createLogger(config.logLevel)
): MemeSignalService | null {
  if (!config.aiEnabled) {
    return null;
  }

  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_ENABLED=true");
  }

  return new MemeSignalService(
    config,
    repository,
    new OpenAIMemeSignalAnalyzer(
      {
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        model: config.openaiModel,
        reasoningEffort: config.openaiReasoningEffort,
        storeResponses: config.openaiStoreResponses,
        timeoutMs: config.openaiTimeoutMs
      },
      logger
    ),
    logger
  );
}

export function createDexDiscoveryService(
  config: AppConfig,
  repository: PostRepository,
  logger = createLogger(config.logLevel)
): DexDiscoveryService | null {
  if (!config.dexDiscoveryEnabled) {
    return null;
  }

  return new DexDiscoveryService(
    config,
    repository,
    new HttpDexScreenerClient(config.dexScreenerBaseUrl),
    logger,
    new CompositeFreeTokenSecurityChecker([
      new SolanaFreeTokenSecurityChecker(config.solanaRpcUrl)
    ])
  );
}

export function createVercelRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  repository: PostRepository;
  scraper: TimelineScraper;
  memeSignalService: MemeSignalService | null;
} {
  const config = loadVercelPollingConfig(env);
  const logger = createLogger(config.logLevel);
  const repository = PostgresRepository.fromEnv(env);

  return {
    config,
    repository,
    scraper: new XCookieScraper(
      {
        authToken: config.xAuthToken ?? undefined,
        ct0: config.xCsrfToken ?? undefined,
        cookieHeader: config.xCookieHeader ?? undefined,
        guestToken: config.xGuestToken ?? undefined,
        bearerToken: config.xBearerToken ?? undefined,
        userTweetsUrl: config.xUserTweetsUrl ?? undefined,
        clientTransactionId: config.xClientTransactionId ?? undefined,
        userAgent: config.xUserAgent ?? undefined
      },
      logger
    ),
    memeSignalService: createMemeSignalService(config, repository, logger)
  };
}

export function createVercelDexDiscoveryRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  repository: PostRepository;
  dexDiscoveryService: DexDiscoveryService | null;
} {
  const config = loadVercelConfig(env);
  const logger = createLogger(config.logLevel);
  const repository = PostgresRepository.fromEnv(env);

  return {
    config,
    repository,
    dexDiscoveryService: createDexDiscoveryService(config, repository, logger)
  };
}

export function isAuthorizedCronRequest(request: Request, config: Pick<AppConfig, "cronSecret">): boolean {
  if (!config.cronSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${config.cronSecret}`;
}
