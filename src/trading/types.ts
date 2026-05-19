export type TradingInputSymbol = "SOL" | "USDC" | "USDT";
export type TradeIntentStatus = "pending" | "confirmed" | "executed" | "expired" | "cancelled" | "failed";
export type TradeExecutionStatus = "submitted" | "confirmed" | "failed";

export interface TradingConfig {
  tradingEnabled: boolean;
  telegramBotToken: string | null;
  telegramWebhookSecret: string | null;
  telegramAllowedUserIds: Set<string>;
  publicBaseUrl: string | null;
  solanaRpcUrl: string;
  solanaWalletSecretKey: string | null;
  jupiterApiKey: string | null;
  jupiterApiBaseUrl: string;
  defaultSlippageBps: number;
  maxSlippageBps: number;
  maxPriceImpactPct: number;
  minSolFeeBalance: number;
  minSolReserve: number;
  maxBuySol: number;
  maxBuyUsdc: number;
  maxBuyUsdt: number;
  tradeIntentTtlSeconds: number;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type?: string;
  };
  from?: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface ParsedTelegramCommand {
  name: "buy" | "confirm" | "cancel" | "balance" | "help" | "unknown";
  args: string[];
  raw: string;
}

export interface TradeIntentInput {
  telegramUserId: string;
  chatId: string;
  inputSymbol: TradingInputSymbol;
  inputMint: string;
  outputMint: string;
  inputAmountUi: string;
  inputAmountBaseUnits: string;
  slippageBps: number;
  quoteJson: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

export interface TradeIntentRecord extends TradeIntentInput {
  id: string;
  status: TradeIntentStatus;
  updatedAt: string;
}

export interface TradeExecutionInput {
  intentId: string;
  signature: string | null;
  status: TradeExecutionStatus;
  explorerUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TradeExecutionRecord extends TradeExecutionInput {
  id: string;
}

export interface TradingRepository {
  recordTelegramUpdate(updateId: number, receivedAt: string): Promise<boolean>;
  createTradeIntent(input: TradeIntentInput): Promise<TradeIntentRecord>;
  getTradeIntent(id: string): Promise<TradeIntentRecord | null>;
  setTradeIntentStatus(id: string, status: TradeIntentStatus, updatedAt: string): Promise<void>;
  createTradeExecution(input: TradeExecutionInput): Promise<TradeExecutionRecord>;
  close(): Promise<void>;
}

export interface JupiterOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps: number;
}

export interface JupiterOrderResponse {
  requestId: string;
  transaction: string;
  error?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps?: number;
  routePlan?: unknown;
  [key: string]: unknown;
}

export interface JupiterExecuteResponse {
  signature?: string;
  status?: string;
  error?: string;
  code?: number;
  [key: string]: unknown;
}

export interface JupiterClient {
  createOrder(request: JupiterOrderRequest): Promise<JupiterOrderResponse>;
  executeSignedTransaction(params: { requestId: string; signedTransaction: string }): Promise<JupiterExecuteResponse>;
}

export interface SolanaWalletClient {
  publicKey(): string;
  signBase64Transaction(transaction: string): Promise<string>;
  getSolBalance(): Promise<number>;
  getSplTokenBalance(mint: string): Promise<number>;
}
