import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import type { DexTokenCandidateRecord } from "../types.js";
import { SolanaFreeTokenSecurityChecker } from "./freeSecurityChecks.js";

function candidate(overrides: Partial<DexTokenCandidateRecord> = {}): DexTokenCandidateRecord {
  return {
    postId: "post-1",
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-1",
    baseTokenAddress: "So11111111111111111111111111111111111111112",
    baseTokenName: "Token",
    baseTokenSymbol: "TOK",
    quoteTokenSymbol: "SOL",
    url: "https://dexscreener.com/solana/pair-1",
    priceUsd: 0.01,
    liquidityUsd: 10_000,
    volume24hUsd: 20_000,
    marketCap: 1_000_000,
    fdv: 1_000_000,
    pairCreatedAt: "2026-05-15T10:00:00.000Z",
    matchScore: 80,
    riskFlags: [],
    matchedTerms: [],
    rawPayload: {},
    discoveredAt: "2026-05-15T10:00:00.000Z",
    lastCheckedAt: "2026-05-15T10:00:00.000Z",
    priorityScore: 0,
    priorityReasons: [],
    firstPriceUsd: 0.01,
    firstLiquidityUsd: 10_000,
    firstVolume24hUsd: 20_000,
    previousPriceUsd: 0.01,
    previousLiquidityUsd: 10_000,
    previousVolume24hUsd: 20_000,
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
    narrative: null,
    whySignal: null,
    ...overrides
  };
}

describe("SolanaFreeTokenSecurityChecker", () => {
  it("flags enabled authorities and holder concentration", async () => {
    const connection = {
      getParsedAccountInfo: vi.fn(async () => ({
        value: {
          data: {
            parsed: {
              info: {
                supply: "1000",
                mintAuthority: "mint-authority",
                freezeAuthority: "freeze-authority"
              }
            }
          }
        }
      })),
      getTokenLargestAccounts: vi.fn(async () => ({
        value: [
          {
            address: new PublicKey("11111111111111111111111111111111"),
            amount: "600",
            decimals: 6,
            uiAmount: 0.0006,
            uiAmountString: "0.0006"
          },
          {
            address: new PublicKey("11111111111111111111111111111111"),
            amount: "250",
            decimals: 6,
            uiAmount: 0.00025,
            uiAmountString: "0.00025"
          }
        ]
      }))
    };
    const checker = new SolanaFreeTokenSecurityChecker("https://rpc.test", connection);

    await expect(checker.check(candidate())).resolves.toMatchObject({
      findings: [
        {
          detail: {
            flag: "mint_authority_enabled"
          }
        },
        {
          detail: {
            flag: "freeze_authority_enabled"
          }
        },
        {
          detail: {
            flag: "top_holder_concentration"
          }
        },
        {
          detail: {
            flag: "top10_holder_concentration"
          }
        }
      ]
    });
  });
});
