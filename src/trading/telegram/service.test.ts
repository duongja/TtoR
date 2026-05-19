import { describe, expect, it, vi } from "vitest";

import { USDC_MINT } from "../assets.js";
import { loadTradingConfig } from "../config.js";
import type { TelegramClient } from "./client.js";
import type {
  JupiterClient,
  JupiterOrderRequest,
  JupiterOrderResponse,
  SolanaWalletClient,
  TelegramUpdate,
  TradeExecutionInput,
  TradeExecutionRecord,
  TradeIntentInput,
  TradeIntentRecord,
  TradeIntentStatus,
  TradingRepository
} from "../types.js";
import { TelegramTradingBotService } from "./service.js";

class MemoryTradingRepository implements TradingRepository {
  public readonly updateIds = new Set<number>();
  public readonly intents = new Map<string, TradeIntentRecord>();
  public readonly executions: TradeExecutionRecord[] = [];
  private nextIntentId = 1;
  private nextExecutionId = 1;

  public async recordTelegramUpdate(updateId: number): Promise<boolean> {
    if (this.updateIds.has(updateId)) {
      return false;
    }
    this.updateIds.add(updateId);
    return true;
  }

  public async createTradeIntent(input: TradeIntentInput): Promise<TradeIntentRecord> {
    const id = String(this.nextIntentId++);
    const record: TradeIntentRecord = {
      ...input,
      id,
      status: "pending",
      updatedAt: input.createdAt
    };
    this.intents.set(id, record);
    return record;
  }

  public async getTradeIntent(id: string): Promise<TradeIntentRecord | null> {
    return this.intents.get(id) ?? null;
  }

  public async setTradeIntentStatus(id: string, status: TradeIntentStatus, updatedAt: string): Promise<void> {
    const existing = this.intents.get(id);
    if (existing) {
      this.intents.set(id, {
        ...existing,
        status,
        updatedAt
      });
    }
  }

  public async createTradeExecution(input: TradeExecutionInput): Promise<TradeExecutionRecord> {
    const record = {
      ...input,
      id: String(this.nextExecutionId++)
    };
    this.executions.push(record);
    return record;
  }

  public async close(): Promise<void> {}
}

function createUpdate(updateId: number, text: string, userId = 42): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text,
      chat: {
        id: 123
      },
      from: {
        id: userId
      }
    }
  };
}

function createService(
  overrides: Partial<{
    priceImpactPct: string;
    solBalance: number;
    executeSignature: string | null;
    executeStatus: string;
    executeCode: number;
  }> = {}
) {
  const repository = new MemoryTradingRepository();
  const sentMessages: string[] = [];
  const telegram: TelegramClient = {
    sendMessage: vi.fn(async (_chatId, text) => {
      sentMessages.push(text);
    })
  };
  const order: JupiterOrderResponse = {
    requestId: "request-1",
    transaction: Buffer.from("fake-transaction").toString("base64"),
    inputMint: USDC_MINT,
    outputMint: "So11111111111111111111111111111111111111112",
    inAmount: "1000000",
    outAmount: "500000",
    priceImpactPct: overrides.priceImpactPct ?? "1"
  };
  const jupiter: JupiterClient = {
    createOrder: vi.fn(async (_request: JupiterOrderRequest) => order),
    executeSignedTransaction: vi.fn(async () => ({
      signature: overrides.executeSignature === undefined ? "sig-1" : overrides.executeSignature ?? undefined,
      status: overrides.executeStatus,
      code: overrides.executeCode
    }))
  };
  const wallet: SolanaWalletClient = {
    publicKey: () => "wallet-1",
    signBase64Transaction: vi.fn(async () => "signed-tx"),
    getSolBalance: vi.fn(async () => overrides.solBalance ?? 10),
    getSplTokenBalance: vi.fn(async () => 1_000)
  };
  const config = loadTradingConfig({
    TRADING_ENABLED: "true",
    TELEGRAM_ALLOWED_USER_IDS: "42",
    TELEGRAM_BOT_TOKEN: "bot",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    SOLANA_WALLET_SECRET_KEY: "secret",
    JUPITER_API_KEY: "jup",
    MAX_PRICE_IMPACT_PCT: "15"
  });
  const service = new TelegramTradingBotService(
    config,
    repository,
    telegram,
    jupiter,
    wallet,
    {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    () => new Date("2026-05-19T00:00:00.000Z")
  );

  return {
    service,
    repository,
    sentMessages,
    jupiter,
    wallet
  };
}

describe("TelegramTradingBotService", () => {
  it("creates a pending trade intent and executes after confirmation", async () => {
    const { service, repository, sentMessages, jupiter } = createService();

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    expect(repository.intents.get("1")).toMatchObject({
      status: "pending",
      inputSymbol: "USDC"
    });
    expect(sentMessages[0]).toContain("/confirm 1");

    await service.handleUpdate(createUpdate(2, "/confirm 1"));
    expect(repository.intents.get("1")?.status).toBe("executed");
    expect(repository.executions[0]).toMatchObject({
      signature: "sig-1",
      status: "submitted"
    });
    expect(jupiter.executeSignedTransaction).toHaveBeenCalledOnce();
  });

  it("rejects unauthorized users and duplicate updates", async () => {
    const { service, repository, sentMessages } = createService();

    await service.handleUpdate(createUpdate(1, "/help", 999));
    expect(sentMessages[0]).toContain("Unauthorized");

    await service.handleUpdate(createUpdate(2, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    await service.handleUpdate(createUpdate(2, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    expect(repository.intents.size).toBe(1);
  });

  it("rejects high price impact quotes", async () => {
    const { service, repository, sentMessages } = createService({ priceImpactPct: "20" });

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    expect(repository.intents.size).toBe(0);
    expect(sentMessages[0]).toContain("Price impact");
  });

  it("requires native SOL for fees when spending SPL tokens", async () => {
    const { service, repository, sentMessages } = createService({ solBalance: 0.001 });

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));

    expect(repository.intents.size).toBe(0);
    expect(sentMessages[0]).toContain("Insufficient SOL for transaction fees");
  });

  it("requires pending confirmations to be unexpired and owned by the user", async () => {
    const { service, repository, sentMessages } = createService();

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    await repository.setTradeIntentStatus("1", "cancelled", "2026-05-19T00:00:01.000Z");
    await service.handleUpdate(createUpdate(2, "/confirm 1"));
    expect(sentMessages.at(-1)).toContain("already cancelled");
  });

  it("records failed Jupiter execute responses", async () => {
    const { service, repository, sentMessages } = createService({ executeSignature: null });

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    await service.handleUpdate(createUpdate(2, "/confirm 1"));
    expect(repository.intents.get("1")?.status).toBe("failed");
    expect(repository.executions[0]).toMatchObject({
      status: "failed"
    });
    expect(sentMessages.at(-1)).toContain("Trade failed");
  });

  it("treats Jupiter status Success with code 0 as a successful execution", async () => {
    const { service, repository } = createService({
      executeStatus: "Success",
      executeCode: 0
    });

    await service.handleUpdate(createUpdate(1, `/buy So11111111111111111111111111111111111111112 1 USDC`));
    await service.handleUpdate(createUpdate(2, "/confirm 1"));

    expect(repository.intents.get("1")?.status).toBe("executed");
    expect(repository.executions[0]).toMatchObject({
      signature: "sig-1",
      status: "submitted"
    });
  });
});
