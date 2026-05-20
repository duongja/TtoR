import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface AppConfig {
  targetHandle: string;
  pollIntervalSeconds: number;
  pollJitterSeconds: number;
  dataDir: string;
  databasePath: string;
  databaseUrl: string;
  browserUserDataDir: string;
  artifactsDir: string;
  headless: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  apiHost: string;
  apiPort: number;
  browserChannel: "chrome" | "chromium";
  cronSecret: string | null;
  xAuthToken: string | null;
  xCsrfToken: string | null;
  xGuestToken: string | null;
  xBearerToken: string | null;
  xUserTweetsUrl: string | null;
  xCookieHeader: string | null;
  xClientTransactionId: string | null;
  xUserAgent: string | null;
  aiEnabled: boolean;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  openaiModel: string;
  openaiReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  openaiStoreResponses: boolean;
  openaiTimeoutMs: number;
  aiMaxPostsPerPoll: number;
  memeSignalThreshold: number;
  dexDiscoveryEnabled: boolean;
  dexDiscoveryMinSignalScore: number;
  dexDiscoveryMaxSignalsPerRun: number;
  dexDiscoveryMaxQueriesPerSignal: number;
  dexDiscoveryCacheTtlMinutes: number;
  dexCandidateRefreshTtlMinutes: number;
  dexCandidateRefreshLimit: number;
  dexRugCheckTtlMinutes: number;
  dexRugCheckLimit: number;
  solanaRpcUrl: string;
  dexDiscoveryMinLiquidityUsd: number;
  dexDiscoveryMinVolume24hUsd: number;
  dexScreenerBaseUrl: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseReasoningEffort(value: string | undefined): AppConfig["openaiReasoningEffort"] {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized;
  }

  return null;
}

function parseDatabasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("sqlite:")) {
    return "./data/app.db";
  }

  return databaseUrl.slice("sqlite:".length) || "./data/app.db";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolve(env.DATA_DIR ?? "./data");
  const databaseUrl = env.DATABASE_URL ?? "sqlite:./data/app.db";
  const rawDatabasePath = parseDatabasePath(databaseUrl);
  const databasePath =
    rawDatabasePath === ":memory:" ? rawDatabasePath : resolve(process.cwd(), rawDatabasePath);
  const browserChannel =
    (env.BROWSER_CHANNEL ?? "chrome").toLowerCase() === "chromium" ? "chromium" : "chrome";

  const logLevelCandidate = (env.LOG_LEVEL ?? "info").toLowerCase();
  const logLevel =
    logLevelCandidate === "debug" ||
    logLevelCandidate === "info" ||
    logLevelCandidate === "warn" ||
    logLevelCandidate === "error"
      ? logLevelCandidate
      : "info";

  return {
    targetHandle: (env.X_TARGET_HANDLE ?? "polymarket").replace(/^@/, ""),
    pollIntervalSeconds: parsePositiveInteger(env.POLL_INTERVAL_SECONDS, 60),
    pollJitterSeconds: parsePositiveInteger(env.POLL_JITTER_SECONDS, 15),
    dataDir,
    databasePath,
    databaseUrl,
    browserUserDataDir: resolve(dataDir, `browser-profile-${browserChannel}`),
    artifactsDir: resolve(dataDir, "artifacts"),
    headless: parseBoolean(env.HEADLESS, true),
    logLevel,
    apiHost: env.API_HOST ?? "127.0.0.1",
    apiPort: parsePositiveInteger(env.API_PORT, 8787),
    browserChannel,
    cronSecret: env.CRON_SECRET ?? null,
    xAuthToken: env.X_AUTH_TOKEN ?? null,
    xCsrfToken: env.X_CSRF_TOKEN ?? env.X_CT0 ?? null,
    xGuestToken: env.X_GUEST_TOKEN ?? null,
    xBearerToken: env.X_BEARER_TOKEN ?? null,
    xUserTweetsUrl: env.X_USER_TWEETS_URL ?? null,
    xCookieHeader: env.X_COOKIE_HEADER ?? null,
    xClientTransactionId: env.X_CLIENT_TRANSACTION_ID ?? null,
    xUserAgent: env.X_USER_AGENT ?? null,
    aiEnabled: parseBoolean(env.AI_ENABLED, false),
    openaiApiKey: env.OPENAI_API_KEY ?? null,
    openaiBaseUrl: env.OPENAI_BASE_URL ?? null,
    openaiModel: env.OPENAI_MODEL ?? "gpt-5.4",
    openaiReasoningEffort: parseReasoningEffort(env.OPENAI_REASONING_EFFORT) ?? "medium",
    openaiStoreResponses: !parseBoolean(env.OPENAI_DISABLE_RESPONSE_STORAGE, true),
    openaiTimeoutMs: clampInteger(parsePositiveInteger(env.OPENAI_TIMEOUT_MS, 30_000), 1_000, 55_000),
    aiMaxPostsPerPoll: clampInteger(parsePositiveInteger(env.AI_MAX_POSTS_PER_POLL, 1), 1, 50),
    memeSignalThreshold: clampInteger(parsePositiveInteger(env.MEME_SIGNAL_THRESHOLD, 70), 0, 100),
    dexDiscoveryEnabled: parseBoolean(env.DEX_DISCOVERY_ENABLED, false),
    dexDiscoveryMinSignalScore: clampInteger(parsePositiveInteger(env.DEX_DISCOVERY_MIN_SIGNAL_SCORE, 70), 0, 100),
    dexDiscoveryMaxSignalsPerRun: clampInteger(parsePositiveInteger(env.DEX_DISCOVERY_MAX_SIGNALS_PER_RUN, 5), 1, 50),
    dexDiscoveryMaxQueriesPerSignal: clampInteger(parsePositiveInteger(env.DEX_DISCOVERY_MAX_QUERIES_PER_SIGNAL, 8), 1, 20),
    dexDiscoveryCacheTtlMinutes: clampInteger(parsePositiveInteger(env.DEX_DISCOVERY_CACHE_TTL_MINUTES, 30), 1, 1440),
    dexCandidateRefreshTtlMinutes: clampInteger(parsePositiveInteger(env.DEX_CANDIDATE_REFRESH_TTL_MINUTES, 10), 1, 1440),
    dexCandidateRefreshLimit: clampInteger(parsePositiveInteger(env.DEX_CANDIDATE_REFRESH_LIMIT, 100), 1, 500),
    dexRugCheckTtlMinutes: clampInteger(parsePositiveInteger(env.DEX_RUG_CHECK_TTL_MINUTES, 10), 1, 1440),
    dexRugCheckLimit: clampInteger(parsePositiveInteger(env.DEX_RUG_CHECK_LIMIT, 100), 1, 500),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    dexDiscoveryMinLiquidityUsd: parseNonNegativeNumber(env.DEX_DISCOVERY_MIN_LIQUIDITY_USD, 5000),
    dexDiscoveryMinVolume24hUsd: parseNonNegativeNumber(env.DEX_DISCOVERY_MIN_VOLUME_24H_USD, 1000),
    dexScreenerBaseUrl: env.DEXSCREENER_BASE_URL ?? "https://api.dexscreener.com"
  };
}

export function ensureRuntimeDirs(config: AppConfig): void {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.browserUserDataDir, { recursive: true });
  mkdirSync(config.artifactsDir, { recursive: true });

  if (config.databasePath !== ":memory:") {
    mkdirSync(dirname(config.databasePath), { recursive: true });
  }
}
