import { createLogger } from "../logger.js";
import { loadConfig } from "../config.js";
import { JupiterSwapClient } from "./jupiter/client.js";
import { PostgresTradingRepository } from "./repository/postgresTradingRepository.js";
import { SolanaHotWalletClient } from "./solana/wallet.js";
import { loadTradingConfig, requireTradingConfig } from "./config.js";
import { TelegramHttpClient } from "./telegram/client.js";
import { TelegramTradingBotService } from "./telegram/service.js";

export function isAuthorizedTelegramWebhook(request: Request, secret: string | null): boolean {
  if (!secret) {
    return false;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === secret;
}

export function createTelegramTradingRuntime(env: NodeJS.ProcessEnv = process.env): {
  tradingConfig: ReturnType<typeof loadTradingConfig>;
  repository: PostgresTradingRepository;
  service: TelegramTradingBotService;
} {
  const appConfig = loadConfig(env);
  const tradingConfig = loadTradingConfig(env);
  requireTradingConfig(tradingConfig);

  const repository = PostgresTradingRepository.fromEnv(env);
  const logger = createLogger(appConfig.logLevel);
  const wallet = new SolanaHotWalletClient(tradingConfig.solanaWalletSecretKey ?? "", tradingConfig.solanaRpcUrl);

  return {
    tradingConfig,
    repository,
    service: new TelegramTradingBotService(
      tradingConfig,
      repository,
      new TelegramHttpClient(tradingConfig.telegramBotToken ?? ""),
      new JupiterSwapClient({
        apiBaseUrl: tradingConfig.jupiterApiBaseUrl,
        apiKey: tradingConfig.jupiterApiKey ?? ""
      }),
      wallet,
      logger
    )
  };
}
