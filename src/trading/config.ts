import type { TradingConfig } from "./types.js";

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

function parseNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseAllowedUsers(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function loadTradingConfig(env: NodeJS.ProcessEnv = process.env): TradingConfig {
  return {
    tradingEnabled: parseBoolean(env.TRADING_ENABLED, false),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
    telegramAllowedUserIds: parseAllowedUsers(env.TELEGRAM_ALLOWED_USER_IDS),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    solanaWalletSecretKey: env.SOLANA_WALLET_SECRET_KEY ?? null,
    jupiterApiKey: env.JUPITER_API_KEY ?? null,
    jupiterApiBaseUrl: env.JUPITER_API_BASE_URL ?? "https://api.jup.ag",
    defaultSlippageBps: parseInteger(env.DEFAULT_SLIPPAGE_BPS, 500, 1, 10_000),
    maxSlippageBps: parseInteger(env.MAX_SLIPPAGE_BPS, 1_000, 1, 10_000),
    maxPriceImpactPct: parseNumber(env.MAX_PRICE_IMPACT_PCT, 15, 0, 100),
    minSolFeeBalance: parseNumber(env.MIN_SOL_FEE_BALANCE, 0.005, 0, 1_000),
    minSolReserve: parseNumber(env.MIN_SOL_RESERVE, 0.02, 0, 1_000),
    maxBuySol: parseNumber(env.MAX_BUY_SOL, 1, 0, 1_000_000),
    maxBuyUsdc: parseNumber(env.MAX_BUY_USDC, 500, 0, 1_000_000_000),
    maxBuyUsdt: parseNumber(env.MAX_BUY_USDT, 500, 0, 1_000_000_000),
    tradeIntentTtlSeconds: parseInteger(env.TRADE_INTENT_TTL_SECONDS, 60, 10, 600)
  };
}

export function requireTradingConfig(config: TradingConfig): void {
  if (!config.tradingEnabled) {
    throw new Error("Trading is disabled. Set TRADING_ENABLED=true to enable the Telegram trading bot.");
  }
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required when trading is enabled");
  }
  if (!config.telegramWebhookSecret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required when trading is enabled");
  }
  if (config.telegramAllowedUserIds.size === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS is required when trading is enabled");
  }
  if (!config.solanaWalletSecretKey) {
    throw new Error("SOLANA_WALLET_SECRET_KEY is required when trading is enabled");
  }
  if (!config.jupiterApiKey) {
    throw new Error("JUPITER_API_KEY is required when trading is enabled");
  }
}
