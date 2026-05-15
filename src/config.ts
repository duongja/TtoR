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

function parseDatabasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("sqlite:")) {
    throw new Error(`Unsupported DATABASE_URL "${databaseUrl}". Expected sqlite:...`);
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
    targetHandle: (env.X_TARGET_HANDLE ?? "realDonaldTrump").replace(/^@/, ""),
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
    browserChannel
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
