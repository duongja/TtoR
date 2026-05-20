import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { Repository } from "../storage.js";
import type { DexRugpullFlag, DexRugpullLevel, MemeSignalAnalysisPayload, NormalizedPost } from "../types.js";
import type { DexScreenerClient } from "./dexScreenerClient.js";
import { DexDiscoveryService } from "./discoveryService.js";
import type { FreeTokenSecurityChecker } from "./freeSecurityChecks.js";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

const config: Pick<
  AppConfig,
  | "dexDiscoveryMinSignalScore"
  | "dexDiscoveryMaxSignalsPerRun"
  | "dexDiscoveryMaxQueriesPerSignal"
  | "dexDiscoveryCacheTtlMinutes"
  | "dexCandidateRefreshTtlMinutes"
  | "dexCandidateRefreshLimit"
  | "dexRugCheckTtlMinutes"
  | "dexRugCheckLimit"
  | "dexDiscoveryMinLiquidityUsd"
  | "dexDiscoveryMinVolume24hUsd"
> = {
  dexDiscoveryMinSignalScore: 70,
  dexDiscoveryMaxSignalsPerRun: 5,
  dexDiscoveryMaxQueriesPerSignal: 8,
  dexDiscoveryCacheTtlMinutes: 30,
  dexCandidateRefreshTtlMinutes: 10,
  dexCandidateRefreshLimit: 100,
  dexRugCheckTtlMinutes: 10,
  dexRugCheckLimit: 100,
  dexDiscoveryMinLiquidityUsd: 5000,
  dexDiscoveryMinVolume24hUsd: 1000
};

function createPost(postId: string): NormalizedPost {
  return {
    postId,
    authorHandle: "polymarket",
    authorDisplayName: "Polymarket",
    createdAt: "2026-05-15T10:00:00.000Z",
    detectedAt: "2026-05-15T10:00:05.000Z",
    text: "Concrete skull recovered",
    lang: "en",
    conversationId: postId,
    replyToPostId: null,
    quotedPostId: null,
    isRepost: false,
    media: [],
    rawPayload: {}
  };
}

const analysis: MemeSignalAnalysisPayload = {
  hasMemecoinSignal: true,
  signalScore: 91,
  confidence: "high",
  narrative: "Concrete skull recovered",
  whySignal: "Short bizarre visual phrase.",
  searchTerms: ["concrete skull"],
  possibleNames: [
    {
      name: "Concrete Skull",
      ticker: "SKULL",
      priority: 95,
      reason: "Direct match."
    }
  ],
  entities: [],
  urgency: "high",
  sensitivityFlags: [],
  recommendedAction: "urgent_search"
};

describe("DexDiscoveryService", () => {
  it("searches pending signals and stores candidates", async () => {
    const repository = Repository.open(":memory:");
    repository.recordPollRun({
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:05.000Z",
      status: "success",
      posts: [createPost("post-1")]
    });
    repository.saveMemeSignalAnalysis({
      postId: "post-1",
      status: "success",
      model: "test",
      promptVersion: "test",
      analysis,
      createdAt: "2026-05-15T10:00:06.000Z"
    });

    const client: DexScreenerClient = {
      searchPairs: vi.fn(async () => [
        {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "pair-1",
          url: "https://dexscreener.com/solana/pair-1",
          baseToken: {
            address: "token-1",
            name: "Concrete Skull",
            symbol: "SKULL"
          },
          liquidity: {
            usd: 25_000
          },
          volume: {
            h24: 50_000
          },
          pairCreatedAt: Date.parse("2026-05-15T09:00:00.000Z")
        }
      ]),
      getPairsByChainAndAddresses: vi.fn(async () => [])
    };
    const service = new DexDiscoveryService(
      config,
      repository,
      client,
      silentLogger,
      null,
      () => new Date("2026-05-15T10:00:10.000Z")
    );

    await expect(service.discoverPendingSignals()).resolves.toMatchObject({
      analyzedSignalCount: 1,
      candidateCount: 1,
      refreshedCandidateCount: 0,
      rugCheckedCandidateCount: 0,
      errorCount: 0
    });
    expect(repository.getDexDiscoveryForPost("post-1")).toMatchObject([
      {
        postId: "post-1",
        baseTokenSymbol: "SKULL",
        priorityScore: 15
      }
    ]);

    repository.close();
  });

  it("refreshes stale tracked candidates and marks performing tokens as priority", async () => {
    const repository = Repository.open(":memory:");
    repository.recordPollRun({
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:05.000Z",
      status: "success",
      posts: [createPost("post-1")]
    });
    repository.saveMemeSignalAnalysis({
      postId: "post-1",
      status: "success",
      model: "test",
      promptVersion: "test",
      analysis,
      createdAt: "2026-05-15T10:00:06.000Z"
    });
    repository.upsertDexTokenCandidates("post-1", [
      {
        postId: "post-1",
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "pair-1",
        baseTokenAddress: "token-1",
        baseTokenName: "Concrete Skull",
        baseTokenSymbol: "SKULL",
        quoteTokenSymbol: "SOL",
        url: "https://dexscreener.com/solana/pair-1",
        priceUsd: 0.001,
        liquidityUsd: 20_000,
        volume24hUsd: 20_000,
        marketCap: 500_000,
        fdv: 500_000,
        pairCreatedAt: "2026-05-15T09:00:00.000Z",
        matchScore: 91,
        riskFlags: ["new_pair"],
        matchedTerms: ["concrete skull"],
        rawPayload: {},
        discoveredAt: "2026-05-15T10:00:10.000Z",
        lastCheckedAt: "2026-05-15T10:00:10.000Z",
        priorityScore: 15,
        priorityReasons: ["fresh_launch"]
      }
    ]);
    repository.saveDexRugpullRisk({
      postId: "post-1",
      chainId: "solana",
      pairAddress: "pair-1",
      baseTokenAddress: "token-1",
      rugpullScore: 20,
      previousRugpullScore: null,
      rugpullLevel: "low",
      rugpullTrend: "stable",
      rugpullFlags: [],
      rugpullDetails: [],
      rawPayload: {},
      checkedAt: "2026-05-15T10:00:10.000Z"
    });
    repository.saveDexDiscoveryRun({
      postId: "post-1",
      status: "success",
      startedAt: "2026-05-15T10:00:10.000Z",
      finishedAt: "2026-05-15T10:00:11.000Z",
      signalCount: 1,
      candidateCount: 1,
      errorCount: 0
    });

    const client: DexScreenerClient = {
      searchPairs: vi.fn(async () => []),
      getPairsByChainAndAddresses: vi.fn(async () => [
        {
          chainId: "solana",
          dexId: "raydium",
          pairAddress: "pair-1",
          url: "https://dexscreener.com/solana/pair-1",
          baseToken: {
            address: "token-1",
            name: "Concrete Skull",
            symbol: "SKULL"
          },
          quoteToken: {
            symbol: "SOL"
          },
          priceUsd: "0.003",
          liquidity: {
            usd: 70_000
          },
          volume: {
            h24: 150_000
          },
          pairCreatedAt: Date.parse("2026-05-15T09:00:00.000Z")
        }
      ])
    };
    const service = new DexDiscoveryService(
      {
        ...config,
        dexDiscoveryCacheTtlMinutes: 1_000_000,
        dexCandidateRefreshTtlMinutes: 10,
        dexRugCheckTtlMinutes: 1_000_000
      },
      repository,
      client,
      silentLogger,
      null,
      () => new Date("2026-05-15T10:20:10.000Z")
    );

    await expect(service.discoverPendingSignals()).resolves.toMatchObject({
      analyzedSignalCount: 0,
      refreshedCandidateCount: 1,
      rugCheckedCandidateCount: 0,
      highPriorityCount: 1,
      errorCount: 0
    });
    expect(client.getPairsByChainAndAddresses).toHaveBeenCalledWith("solana", ["pair-1"]);
    expect(repository.getDexDiscoveryForPost("post-1")).toMatchObject([
      {
        priceUsd: 0.003,
        previousPriceUsd: 0.001,
        firstPriceUsd: 0.001,
        priorityReasons: expect.arrayContaining(["price_up_since_last_check", "price_up_since_discovery"])
      }
    ]);

    repository.close();
  });

  it("runs stale rug-risk checks without hiding candidates", async () => {
    const repository = Repository.open(":memory:");
    repository.recordPollRun({
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:05.000Z",
      status: "success",
      posts: [createPost("post-1")]
    });
    repository.saveMemeSignalAnalysis({
      postId: "post-1",
      status: "success",
      model: "test",
      promptVersion: "test",
      analysis,
      createdAt: "2026-05-15T10:00:06.000Z"
    });
    repository.upsertDexTokenCandidates("post-1", [
      {
        postId: "post-1",
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "pair-risk",
        baseTokenAddress: "token-risk",
        baseTokenName: "Risk Skull",
        baseTokenSymbol: "RSKULL",
        quoteTokenSymbol: "SOL",
        url: "https://dexscreener.com/solana/pair-risk",
        priceUsd: 0.0002,
        liquidityUsd: 800,
        volume24hUsd: 80_000,
        marketCap: 1_000_000,
        fdv: 900_000,
        pairCreatedAt: "2026-05-15T10:00:00.000Z",
        matchScore: 80,
        riskFlags: ["missing_socials", "new_pair"],
        matchedTerms: ["concrete skull"],
        rawPayload: {},
        discoveredAt: "2026-05-15T10:00:10.000Z",
        lastCheckedAt: "2026-05-15T10:00:10.000Z",
        priorityScore: 15,
        priorityReasons: ["fresh_launch"]
      }
    ]);
    repository.saveDexDiscoveryRun({
      postId: "post-1",
      status: "success",
      startedAt: "2026-05-15T10:00:10.000Z",
      finishedAt: "2026-05-15T10:00:11.000Z",
      signalCount: 1,
      candidateCount: 1,
      errorCount: 0
    });

    const client: DexScreenerClient = {
      searchPairs: vi.fn(async () => []),
      getPairsByChainAndAddresses: vi.fn(async () => [])
    };
    const freeSecurityChecker: FreeTokenSecurityChecker = {
      check: vi.fn(async () => ({
        findings: [
          {
            detail: {
              flag: "mint_authority_enabled" as DexRugpullFlag,
              severity: "critical" as DexRugpullLevel,
              points: 30,
              description: "Solana mint authority is still enabled."
            },
            rawPayload: {
              mintAuthority: "authority"
            }
          }
        ],
        rawPayload: {
          mintAuthority: "authority"
        }
      }))
    };
    const service = new DexDiscoveryService(
      {
        ...config,
        dexDiscoveryCacheTtlMinutes: 1_000_000,
        dexCandidateRefreshTtlMinutes: 1_000_000,
        dexRugCheckTtlMinutes: 10
      },
      repository,
      client,
      silentLogger,
      freeSecurityChecker,
      () => new Date("2026-05-15T10:20:10.000Z")
    );

    await expect(service.discoverPendingSignals()).resolves.toMatchObject({
      analyzedSignalCount: 0,
      refreshedCandidateCount: 0,
      rugCheckedCandidateCount: 1,
      highRugRiskCount: 1,
      errorCount: 0
    });
    expect(repository.getDexDiscoveryForPost("post-1")).toMatchObject([
      {
        pairAddress: "pair-risk",
        rugpullLevel: "critical",
        rugpullFlags: expect.arrayContaining(["mint_authority_enabled", "critical_liquidity", "extreme_fdv_liquidity", "extreme_volume_liquidity"])
      }
    ]);
    expect(freeSecurityChecker.check).toHaveBeenCalledTimes(1);

    repository.close();
  });
});
