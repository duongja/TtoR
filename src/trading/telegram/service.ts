import { TRADING_ASSETS } from "../assets.js";
import type { Logger } from "../../logger.js";
import {
  explorerUrl,
  formatBalanceMessage,
  formatExecutionMessage,
  formatQuoteMessage,
  HELP_MESSAGE
} from "./messages.js";
import { parseBuyCommand, parseTelegramCommand, parseTradeId } from "./commands.js";
import type { TelegramClient } from "./client.js";
import type {
  JupiterClient,
  JupiterOrderResponse,
  SolanaWalletClient,
  TelegramUpdate,
  TradeExecutionRecord,
  TradeIntentRecord,
  TradingConfig,
  TradingRepository
} from "../types.js";

export class TelegramTradingBotService {
  public constructor(
    private readonly config: TradingConfig,
    private readonly repository: TradingRepository,
    private readonly telegram: TelegramClient,
    private readonly jupiter: JupiterClient,
    private readonly wallet: SolanaWalletClient,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async handleUpdate(update: TelegramUpdate): Promise<void> {
    const isNewUpdate = await this.repository.recordTelegramUpdate(update.update_id, this.now().toISOString());
    if (!isNewUpdate) {
      this.logger.debug("Skipping duplicate Telegram update", { updateId: update.update_id });
      return;
    }

    const message = update.message;
    if (!message?.text || !message.from) {
      return;
    }

    const chatId = String(message.chat.id);
    const userId = String(message.from.id);

    if (!this.config.telegramAllowedUserIds.has(userId)) {
      await this.telegram.sendMessage(chatId, "Unauthorized Telegram user.");
      this.logger.warn("Rejected unauthorized Telegram user", { userId });
      return;
    }

    const command = parseTelegramCommand(message.text);
    try {
      if (command.name === "help" || command.name === "unknown") {
        await this.telegram.sendMessage(chatId, HELP_MESSAGE);
        return;
      }
      if (command.name === "balance") {
        await this.handleBalance(chatId);
        return;
      }
      if (command.name === "buy") {
        await this.handleBuy(chatId, userId, command.args);
        return;
      }
      if (command.name === "confirm") {
        await this.handleConfirm(chatId, userId, parseTradeId(command.args, "confirm"));
        return;
      }
      if (command.name === "cancel") {
        await this.handleCancel(chatId, userId, parseTradeId(command.args, "cancel"));
      }
    } catch (error) {
      await this.telegram.sendMessage(chatId, error instanceof Error ? error.message : "Unknown trading bot error");
    }
  }

  private async handleBalance(chatId: string): Promise<void> {
    const [sol, usdc, usdt] = await Promise.all([
      this.wallet.getSolBalance(),
      this.wallet.getSplTokenBalance(TRADING_ASSETS.USDC.mint),
      this.wallet.getSplTokenBalance(TRADING_ASSETS.USDT.mint)
    ]);

    await this.telegram.sendMessage(
      chatId,
      formatBalanceMessage({
        publicKey: this.wallet.publicKey(),
        sol,
        usdc,
        usdt
      })
    );
  }

  private async handleBuy(chatId: string, userId: string, args: string[]): Promise<void> {
    const buy = parseBuyCommand(args, this.config);
    await this.assertBalanceForBuy(buy.inputSymbol, Number.parseFloat(buy.amountUi));

    const quote = await this.jupiter.createOrder({
      inputMint: buy.inputMint,
      outputMint: buy.outputMint,
      amount: buy.amountBaseUnits,
      taker: this.wallet.publicKey(),
      slippageBps: Math.min(this.config.defaultSlippageBps, this.config.maxSlippageBps)
    });

    this.assertQuoteRisk(quote);

    const createdAt = this.now();
    const intent = await this.repository.createTradeIntent({
      telegramUserId: userId,
      chatId,
      inputSymbol: buy.inputSymbol,
      inputMint: buy.inputMint,
      outputMint: buy.outputMint,
      inputAmountUi: buy.amountUi,
      inputAmountBaseUnits: buy.amountBaseUnits,
      slippageBps: Math.min(this.config.defaultSlippageBps, this.config.maxSlippageBps),
      quoteJson: quote,
      expiresAt: new Date(createdAt.getTime() + this.config.tradeIntentTtlSeconds * 1_000).toISOString(),
      createdAt: createdAt.toISOString()
    });

    await this.telegram.sendMessage(chatId, formatQuoteMessage(intent));
  }

  private async handleConfirm(chatId: string, userId: string, tradeId: string): Promise<void> {
    const intent = await this.getActionableIntent(tradeId, userId, "confirm");
    await this.repository.setTradeIntentStatus(intent.id, "confirmed", this.now().toISOString());

    try {
      const quote = intent.quoteJson as JupiterOrderResponse;
      this.assertQuoteRisk(quote);
      const signedTransaction = await this.wallet.signBase64Transaction(quote.transaction);
      const result = await this.jupiter.executeSignedTransaction({
        requestId: quote.requestId,
        signedTransaction
      });

      if (result.status === "Failed" || (typeof result.code === "number" && result.code !== 0)) {
        throw new Error(result.error ?? `Jupiter execution failed with status ${result.status ?? "unknown"}`);
      }

      const signature = result.signature ?? null;
      if (!signature) {
        throw new Error(result.error ?? "Jupiter execution did not return a signature");
      }

      const execution = await this.repository.createTradeExecution({
        intentId: intent.id,
        signature,
        status: "submitted",
        explorerUrl: explorerUrl(signature),
        errorMessage: null,
        createdAt: this.now().toISOString(),
        confirmedAt: null
      });
      await this.repository.setTradeIntentStatus(intent.id, "executed", this.now().toISOString());
      await this.telegram.sendMessage(chatId, formatExecutionMessage(execution));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution failure";
      const execution: TradeExecutionRecord = await this.repository.createTradeExecution({
        intentId: intent.id,
        signature: null,
        status: "failed",
        explorerUrl: null,
        errorMessage: message,
        createdAt: this.now().toISOString(),
        confirmedAt: null
      });
      await this.repository.setTradeIntentStatus(intent.id, "failed", this.now().toISOString());
      await this.telegram.sendMessage(chatId, formatExecutionMessage(execution));
    }
  }

  private async handleCancel(chatId: string, userId: string, tradeId: string): Promise<void> {
    const intent = await this.getActionableIntent(tradeId, userId, "cancel");
    await this.repository.setTradeIntentStatus(intent.id, "cancelled", this.now().toISOString());
    await this.telegram.sendMessage(chatId, `Trade #${intent.id} cancelled.`);
  }

  private async getActionableIntent(
    tradeId: string,
    userId: string,
    action: "confirm" | "cancel"
  ): Promise<TradeIntentRecord> {
    const intent = await this.repository.getTradeIntent(tradeId);
    if (!intent) {
      throw new Error(`Trade #${tradeId} was not found`);
    }
    if (intent.telegramUserId !== userId) {
      throw new Error(`You cannot ${action} this trade`);
    }
    if (intent.status !== "pending") {
      throw new Error(`Trade #${tradeId} is already ${intent.status}`);
    }
    if (Date.parse(intent.expiresAt) <= this.now().getTime()) {
      await this.repository.setTradeIntentStatus(intent.id, "expired", this.now().toISOString());
      throw new Error(`Trade #${tradeId} has expired. Request a new quote.`);
    }

    return intent;
  }

  private assertQuoteRisk(quote: JupiterOrderResponse): void {
    const priceImpact = Number.parseFloat(quote.priceImpactPct);
    if (Number.isFinite(priceImpact) && priceImpact > this.config.maxPriceImpactPct) {
      throw new Error(`Price impact ${priceImpact}% exceeds max ${this.config.maxPriceImpactPct}%`);
    }
  }

  private async assertBalanceForBuy(inputSymbol: "SOL" | "USDC" | "USDT", amount: number): Promise<void> {
    const solBalance = await this.wallet.getSolBalance();
    if (inputSymbol === "SOL") {
      if (solBalance - amount < this.config.minSolReserve) {
        throw new Error(`Insufficient SOL balance. Keep at least ${this.config.minSolReserve} SOL reserved for fees.`);
      }
      return;
    }

    if (solBalance < this.config.minSolFeeBalance) {
      throw new Error(`Insufficient SOL for transaction fees. Keep at least ${this.config.minSolFeeBalance} native SOL.`);
    }

    const mint = TRADING_ASSETS[inputSymbol].mint;
    const balance = await this.wallet.getSplTokenBalance(mint);
    if (balance < amount) {
      throw new Error(`Insufficient ${inputSymbol} balance`);
    }
  }
}
