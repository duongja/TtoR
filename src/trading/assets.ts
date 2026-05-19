import type { TradingInputSymbol } from "./types.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export interface TradingAsset {
  symbol: TradingInputSymbol;
  mint: string;
  decimals: number;
}

export const TRADING_ASSETS: Record<TradingInputSymbol, TradingAsset> = {
  SOL: {
    symbol: "SOL",
    mint: SOL_MINT,
    decimals: 9
  },
  USDC: {
    symbol: "USDC",
    mint: USDC_MINT,
    decimals: 6
  },
  USDT: {
    symbol: "USDT",
    mint: USDT_MINT,
    decimals: 6
  }
};

export function parseTradingInputSymbol(value: string): TradingInputSymbol | null {
  const normalized = value.trim().toUpperCase();
  return normalized === "SOL" || normalized === "USDC" || normalized === "USDT" ? normalized : null;
}

export function toBaseUnits(amountUi: string, decimals: number): string {
  const trimmed = amountUi.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a positive decimal number");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }

  const base = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+/, "");
  return base || "0";
}

export function fromBaseUnits(amount: string, decimals: number, maxFractionDigits = 6): string {
  const normalized = amount.replace(/^0+/, "") || "0";
  if (decimals === 0) {
    return normalized;
  }

  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, maxFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole;
}
