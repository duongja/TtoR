import { describe, expect, it } from "vitest";

import { SOL_MINT, USDC_MINT } from "../assets.js";
import { loadTradingConfig } from "../config.js";
import { parseBuyCommand, parseTelegramCommand, parseTradeId } from "./commands.js";

const config = loadTradingConfig({
  MAX_BUY_SOL: "1",
  MAX_BUY_USDC: "500",
  MAX_BUY_USDT: "500"
});

describe("telegram trading commands", () => {
  it("parses buy commands with SOL, USDC, and USDT input assets", () => {
    const mint = "DezXAZ8z7PnrnRJjz3N9C7V9BGDgqD7nJrwhAQwFvZLM";

    expect(parseTelegramCommand(`/buy ${mint} 0.25 SOL`)).toMatchObject({
      name: "buy",
      args: [mint, "0.25", "SOL"]
    });
    expect(parseBuyCommand([mint, "0.25", "SOL"], config)).toMatchObject({
      amountBaseUnits: "250000000",
      inputSymbol: "SOL"
    });
    expect(parseBuyCommand([mint, "10", "USDC"], config)).toMatchObject({
      amountBaseUnits: "10000000",
      inputSymbol: "USDC"
    });
    expect(parseBuyCommand([mint, "10", "USDT"], config)).toMatchObject({
      amountBaseUnits: "10000000",
      inputSymbol: "USDT"
    });
  });

  it("rejects unsafe or malformed commands", () => {
    expect(() => parseBuyCommand(["bad", "1", "SOL"], config)).toThrow("valid Solana address");
    expect(() => parseBuyCommand([USDC_MINT, "2", "SOL"], config)).toThrow("exceeds");
    expect(() => parseTradeId(["abc"], "confirm")).toThrow("Usage");
  });

  it("accepts common asset aliases as output tokens", () => {
    expect(parseBuyCommand(["SOL", "1", "USDT"], config)).toMatchObject({
      outputMint: SOL_MINT,
      inputSymbol: "USDT"
    });

    expect(() => parseBuyCommand(["USDT", "1", "USDT"], config)).toThrow(
      "Output token must be different from the spend asset"
    );
  });
});
