import { loadConfig, type AppConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { PostgresRepository } from "./postgresRepository.js";
import type { PostRepository } from "./repository.js";
import { XCookieScraper } from "./scraper/xCookieScraper.js";
import type { TimelineScraper } from "./types.js";

export function loadVercelConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = loadConfig(env);

  if (!config.xCookieHeader && (!config.xAuthToken || !config.xCsrfToken)) {
    throw new Error("X_COOKIE_HEADER or both X_AUTH_TOKEN and X_CSRF_TOKEN are required for Vercel monitoring");
  }

  return config;
}

export function createVercelRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: AppConfig;
  repository: PostRepository;
  scraper: TimelineScraper;
} {
  const config = loadVercelConfig(env);
  const logger = createLogger(config.logLevel);

  return {
    config,
    repository: PostgresRepository.fromEnv(env),
    scraper: new XCookieScraper(
      {
        authToken: config.xAuthToken ?? undefined,
        ct0: config.xCsrfToken ?? undefined,
        cookieHeader: config.xCookieHeader ?? undefined,
        guestToken: config.xGuestToken ?? undefined,
        bearerToken: config.xBearerToken ?? undefined,
        userTweetsUrl: config.xUserTweetsUrl ?? undefined
      },
      logger
    )
  };
}

export function isAuthorizedCronRequest(request: Request, config: Pick<AppConfig, "cronSecret">): boolean {
  if (!config.cronSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${config.cronSecret}`;
}
