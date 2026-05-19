import postgres, { type Sql } from "postgres";

import type {
  TradeExecutionInput,
  TradeExecutionRecord,
  TradeIntentInput,
  TradeIntentRecord,
  TradingRepository
} from "../types.js";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    return parseJson(JSON.parse(value), fallback);
  }
  return value as T;
}

type JsonValue = Parameters<Sql["json"]>[0];

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToTradeIntent(row: Record<string, unknown>): TradeIntentRecord {
  return {
    id: String(row.id),
    telegramUserId: String(row.telegram_user_id),
    chatId: String(row.chat_id),
    inputSymbol: row.input_symbol as TradeIntentRecord["inputSymbol"],
    inputMint: String(row.input_mint),
    outputMint: String(row.output_mint),
    inputAmountUi: String(row.input_amount_ui),
    inputAmountBaseUnits: String(row.input_amount_base_units),
    slippageBps: Number(row.slippage_bps),
    quoteJson: parseJson<Record<string, unknown>>(row.quote_json, {}),
    status: row.status as TradeIntentRecord["status"],
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToTradeExecution(row: Record<string, unknown>): TradeExecutionRecord {
  return {
    id: String(row.id),
    intentId: String(row.intent_id),
    signature: row.signature ? String(row.signature) : null,
    status: row.status as TradeExecutionRecord["status"],
    explorerUrl: row.explorer_url ? String(row.explorer_url) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: toIso(row.created_at),
    confirmedAt: row.confirmed_at ? toIso(row.confirmed_at) : null
  };
}

export class PostgresTradingRepository implements TradingRepository {
  private initialized = false;

  public constructor(private readonly sql: Sql) {}

  public static fromEnv(env: NodeJS.ProcessEnv = process.env): PostgresTradingRepository {
    const databaseUrl = env.POSTGRES_URL ?? env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("POSTGRES_URL or DATABASE_URL is required for Telegram trading");
    }

    return new PostgresTradingRepository(
      postgres(databaseUrl, {
        max: 1,
        prepare: false
      })
    );
  }

  public async close(): Promise<void> {
    await this.sql.end({ timeout: 1 });
  }

  public async recordTelegramUpdate(updateId: number, receivedAt: string): Promise<boolean> {
    await this.ensureInitialized();
    const rows = await this.sql`
      INSERT INTO telegram_bot_updates (update_id, received_at)
      VALUES (${updateId}, ${receivedAt})
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id
    `;
    return rows.count > 0;
  }

  public async createTradeIntent(input: TradeIntentInput): Promise<TradeIntentRecord> {
    await this.ensureInitialized();
    const rows = await this.sql`
      INSERT INTO telegram_trade_intents (
        telegram_user_id,
        chat_id,
        input_symbol,
        input_mint,
        output_mint,
        input_amount_ui,
        input_amount_base_units,
        slippage_bps,
        quote_json,
        status,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        ${input.telegramUserId},
        ${input.chatId},
        ${input.inputSymbol},
        ${input.inputMint},
        ${input.outputMint},
        ${input.inputAmountUi},
        ${input.inputAmountBaseUnits},
        ${input.slippageBps},
        ${this.sql.json(input.quoteJson as JsonValue)},
        ${"pending"},
        ${input.expiresAt},
        ${input.createdAt},
        ${input.createdAt}
      )
      RETURNING *
    `;

    return rowToTradeIntent(rows[0] as Record<string, unknown>);
  }

  public async getTradeIntent(id: string): Promise<TradeIntentRecord | null> {
    await this.ensureInitialized();
    const rows = await this.sql`
      SELECT *
      FROM telegram_trade_intents
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? rowToTradeIntent(rows[0] as Record<string, unknown>) : null;
  }

  public async setTradeIntentStatus(
    id: string,
    status: TradeIntentRecord["status"],
    updatedAt: string
  ): Promise<void> {
    await this.ensureInitialized();
    await this.sql`
      UPDATE telegram_trade_intents
      SET status = ${status}, updated_at = ${updatedAt}
      WHERE id = ${id}
    `;
  }

  public async createTradeExecution(input: TradeExecutionInput): Promise<TradeExecutionRecord> {
    await this.ensureInitialized();
    const rows = await this.sql`
      INSERT INTO telegram_trade_executions (
        intent_id,
        signature,
        status,
        explorer_url,
        error_message,
        created_at,
        confirmed_at
      ) VALUES (
        ${input.intentId},
        ${input.signature},
        ${input.status},
        ${input.explorerUrl},
        ${input.errorMessage},
        ${input.createdAt},
        ${input.confirmedAt}
      )
      RETURNING *
    `;

    return rowToTradeExecution(rows[0] as Record<string, unknown>);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.sql`
      CREATE TABLE IF NOT EXISTS telegram_bot_updates (
        update_id BIGINT PRIMARY KEY,
        received_at TIMESTAMPTZ NOT NULL
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS telegram_trade_intents (
        id BIGSERIAL PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        input_symbol TEXT NOT NULL,
        input_mint TEXT NOT NULL,
        output_mint TEXT NOT NULL,
        input_amount_ui TEXT NOT NULL,
        input_amount_base_units TEXT NOT NULL,
        slippage_bps INTEGER NOT NULL,
        quote_json JSONB NOT NULL,
        status TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_telegram_trade_intents_status ON telegram_trade_intents(status)`;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_telegram_trade_intents_user ON telegram_trade_intents(telegram_user_id)`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS telegram_trade_executions (
        id BIGSERIAL PRIMARY KEY,
        intent_id BIGINT NOT NULL REFERENCES telegram_trade_intents(id) ON DELETE CASCADE,
        signature TEXT,
        status TEXT NOT NULL,
        explorer_url TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        confirmed_at TIMESTAMPTZ
      )
    `;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_telegram_trade_executions_intent ON telegram_trade_executions(intent_id)`;

    this.initialized = true;
  }
}
