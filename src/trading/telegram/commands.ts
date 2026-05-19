import { PublicKey } from "@solana/web3.js";

import { parseTradingInputSymbol, toBaseUnits, TRADING_ASSETS } from "../assets.js";
import type { ParsedTelegramCommand, TradingConfig, TradingInputSymbol } from "../types.js";

export interface BuyCommand {
  outputMint: string;
  amountUi: string;
  amountBaseUnits: string;
  inputSymbol: TradingInputSymbol;
  inputMint: string;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand {
  const raw = text.trim();
  if (!raw.startsWith("/")) {
    return {
      name: "unknown",
      args: [],
      raw
    };
  }

  const [commandToken, ...args] = raw.split(/\s+/);
  const command = commandToken.slice(1).split("@")[0]?.toLowerCase();

  if (command === "buy" || command === "confirm" || command === "cancel" || command === "balance" || command === "help") {
    return {
      name: command,
      args,
      raw
    };
  }

  return {
    name: "unknown",
    args,
    raw
  };
}

export function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export function parseBuyCommand(args: string[], config: TradingConfig): BuyCommand {
  if (args.length !== 3) {
    throw new Error("Usage: /buy <token_mint> <amount> <SOL|USDC|USDT>");
  }

  const [rawOutputMint, amountUi, rawSymbol] = args;
  const outputAssetAlias = parseTradingInputSymbol(rawOutputMint);
  const outputMint = outputAssetAlias ? TRADING_ASSETS[outputAssetAlias].mint : rawOutputMint;
  if (!isValidPublicKey(outputMint)) {
    throw new Error("Token mint is not a valid Solana address");
  }

  const inputSymbol = parseTradingInputSymbol(rawSymbol);
  if (!inputSymbol) {
    throw new Error("Spend asset must be SOL, USDC, or USDT");
  }

  const inputAsset = TRADING_ASSETS[inputSymbol];
  if (outputMint === inputAsset.mint) {
    throw new Error("Output token must be different from the spend asset");
  }

  const amountBaseUnits = toBaseUnits(amountUi, inputAsset.decimals);
  if (BigInt(amountBaseUnits) <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  const amount = Number.parseFloat(amountUi);
  const max = inputSymbol === "SOL" ? config.maxBuySol : inputSymbol === "USDC" ? config.maxBuyUsdc : config.maxBuyUsdt;
  if (amount > max) {
    throw new Error(`Amount exceeds max ${inputSymbol} buy size of ${max}`);
  }

  return {
    outputMint,
    amountUi,
    amountBaseUnits,
    inputSymbol,
    inputMint: inputAsset.mint
  };
}

export function parseTradeId(args: string[], command: "confirm" | "cancel"): string {
  if (args.length !== 1 || !/^\d+$/.test(args[0])) {
    throw new Error(`Usage: /${command} <trade_id>`);
  }

  return args[0];
}
