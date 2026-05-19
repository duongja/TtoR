import { fromBaseUnits, TRADING_ASSETS } from "../assets.js";
import type { JupiterOrderResponse, TradeExecutionRecord, TradeIntentRecord } from "../types.js";

export const HELP_MESSAGE = [
  "TtoR Solana buy bot",
  "",
  "Commands:",
  "/buy <token_mint> <amount> <SOL|USDC|USDT>",
  "/confirm <trade_id>",
  "/cancel <trade_id>",
  "/balance",
  "/help",
  "",
  "Example:",
  "/buy TOKEN_MINT 0.25 SOL",
  "",
  "The bot always shows a quote before buying. It does not auto-buy from signals."
].join("\n");

export function explorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function formatQuoteMessage(intent: TradeIntentRecord): string {
  const quote = intent.quoteJson as Partial<JupiterOrderResponse>;
  const inputDecimals = TRADING_ASSETS[intent.inputSymbol].decimals;
  const inputAmount = fromBaseUnits(intent.inputAmountBaseUnits, inputDecimals);
  const estimatedOutput = quote.outAmount ? String(quote.outAmount) : "unknown";
  const priceImpact = quote.priceImpactPct ? `${quote.priceImpactPct}%` : "unknown";

  return [
    `Quote ready for trade #${intent.id}`,
    "",
    `Spend: ${inputAmount} ${intent.inputSymbol}`,
    `Buy token: ${intent.outputMint}`,
    `Estimated output raw amount: ${estimatedOutput}`,
    `Price impact: ${priceImpact}`,
    `Slippage: ${intent.slippageBps / 100}%`,
    `Expires: ${new Date(intent.expiresAt).toLocaleTimeString()}`,
    "",
    `Confirm with: /confirm ${intent.id}`,
    `Cancel with: /cancel ${intent.id}`
  ].join("\n");
}

export function formatExecutionMessage(execution: TradeExecutionRecord): string {
  if (!execution.signature) {
    return `Trade failed: ${execution.errorMessage ?? "Unknown error"}`;
  }

  return [
    "Trade submitted.",
    "",
    `Signature: ${execution.signature}`,
    `Explorer: ${execution.explorerUrl ?? explorerUrl(execution.signature)}`
  ].join("\n");
}

export function formatBalanceMessage(params: { publicKey: string; sol: number; usdc: number; usdt: number }): string {
  return [
    "Wallet balance",
    "",
    `Wallet: ${params.publicKey}`,
    `SOL: ${params.sol.toFixed(6)}`,
    `USDC: ${params.usdc.toFixed(6)}`,
    `USDT: ${params.usdt.toFixed(6)}`
  ].join("\n");
}
