import { describe, expect, it } from "vitest";

import type { DexTokenCandidateRecord } from "../types.js";
import { scoreDexRugpullRisk } from "./rugpullScoring.js";

function candidate(overrides: Partial<DexTokenCandidateRecord> = {}): DexTokenCandidateRecord {
  return {
    postId: "post-1",
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-1",
    baseTokenAddress: "token-1",
    baseTokenName: "Safe Token",
    baseTokenSymbol: "SAFE",
    quoteTokenSymbol: "SOL",
    url: "https://dexscreener.com/solana/pair-1",
    priceUsd: 0.01,
    liquidityUsd: 100_000,
    volume24hUsd: 50_000,
    marketCap: 2_000_000,
    fdv: 2_000_000,
    pairCreatedAt: "2026-05-01T00:00:00.000Z",
    matchScore: 80,
    riskFlags: [],
    matchedTerms: ["safe"],
    rawPayload: {},
    discoveredAt: "2026-05-15T10:00:00.000Z",
    lastCheckedAt: "2026-05-15T10:00:00.000Z",
    priorityScore: 0,
    priorityReasons: [],
    firstPriceUsd: 0.01,
    firstLiquidityUsd: 100_000,
    firstVolume24hUsd: 50_000,
    previousPriceUsd: 0.01,
    previousLiquidityUsd: 100_000,
    previousVolume24hUsd: 50_000,
    rugpullScore: 0,
    previousRugpullScore: null,
    rugpullLevel: "low",
    rugpullFlags: [],
    rugpullDetails: [],
    rugpullTrend: "stable",
    lastRugCheckedAt: null,
    createdAt: "2026-05-15T10:00:00.000Z",
    updatedAt: "2026-05-15T10:00:00.000Z",
    signalScore: 80,
    narrative: "Safe narrative",
    whySignal: "Test",
    ...overrides
  };
}

describe("scoreDexRugpullRisk", () => {
  const now = new Date("2026-05-15T10:00:00.000Z");

  it("marks healthy market state as low risk", () => {
    expect(scoreDexRugpullRisk(candidate(), now)).toMatchObject({
      rugpullScore: 0,
      rugpullLevel: "low",
      rugpullTrend: "stable",
      rugpullFlags: []
    });
  });

  it("flags critical liquidity, FDV, and volume anomalies", () => {
    const risk = scoreDexRugpullRisk(
      candidate({
        liquidityUsd: 800,
        volume24hUsd: 80_000,
        fdv: 900_000,
        pairCreatedAt: "2026-05-15T09:30:00.000Z",
        riskFlags: ["missing_socials"]
      }),
      now
    );

    expect(risk.rugpullLevel).toBe("critical");
    expect(risk.rugpullFlags).toEqual(expect.arrayContaining([
      "critical_liquidity",
      "extreme_fdv_liquidity",
      "extreme_volume_liquidity",
      "very_new_pair",
      "missing_socials"
    ]));
  });

  it("detects worsening liquidity and price collapse", () => {
    const risk = scoreDexRugpullRisk(
      candidate({
        priceUsd: 0.004,
        previousPriceUsd: 0.01,
        liquidityUsd: 20_000,
        previousLiquidityUsd: 100_000,
        rugpullScore: 20,
        lastRugCheckedAt: "2026-05-15T09:00:00.000Z"
      }),
      now
    );

    expect(risk.rugpullTrend).toBe("worsening");
    expect(risk.rugpullFlags).toEqual(expect.arrayContaining(["liquidity_collapse", "price_collapse"]));
  });

  it("marks risk as improving when the score drops materially", () => {
    const risk = scoreDexRugpullRisk(
      candidate({
        liquidityUsd: 100_000,
        volume24hUsd: 50_000,
        fdv: 2_000_000,
        rugpullScore: 40,
        lastRugCheckedAt: "2026-05-15T09:00:00.000Z"
      }),
      now
    );

    expect(risk.rugpullTrend).toBe("improving");
    expect(risk.rugpullLevel).toBe("low");
  });

  it("includes free security findings and DexScreener transaction anomalies", () => {
    const risk = scoreDexRugpullRisk(
      candidate({
        rawPayload: {
          priceChange: {
            h1: -70
          },
          txns: {
            h1: {
              buys: 10,
              sells: 50
            }
          }
        }
      }),
      now,
      {
        findings: [
          {
            detail: {
              flag: "mint_authority_enabled",
              severity: "critical",
              points: 30,
              description: "Mint authority is still enabled."
            },
            rawPayload: {
              mintAuthority: "authority"
            }
          }
        ],
        rawPayload: {
          SolanaFreeTokenSecurityChecker: {
            mintAuthority: "authority"
          }
        }
      }
    );

    expect(risk.rugpullFlags).toEqual(expect.arrayContaining([
      "mint_authority_enabled",
      "dex_price_crash",
      "sell_buy_imbalance"
    ]));
    expect(risk.rawPayload.freeSecurityChecks).toMatchObject({
      SolanaFreeTokenSecurityChecker: {
        mintAuthority: "authority"
      }
    });
  });
});
