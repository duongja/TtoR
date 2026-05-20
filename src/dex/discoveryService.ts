import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { PostRepository } from "../repository.js";
import type {
  DexDiscoveryRunInput,
  DexTokenCandidateInput,
  DexTokenCandidateRecord,
  MemeSignalAnalysisRecord
} from "../types.js";
import type { DexScreenerClient, DexScreenerPair } from "./dexScreenerClient.js";
import { buildDexTokenCandidate, normalizeDexPairs, scoreDexTokenPriority } from "./scoring.js";
import { buildDexDiscoveryQueryTerms } from "./queryTerms.js";
import { scoreDexRugpullRisk } from "./rugpullScoring.js";
import type { FreeTokenSecurityChecker } from "./freeSecurityChecks.js";

export interface DexDiscoveryRunSummary {
  analyzedSignalCount: number;
  candidateCount: number;
  refreshedCandidateCount: number;
  highPriorityCount: number;
  rugCheckedCandidateCount: number;
  highRugRiskCount: number;
  errorCount: number;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function signalFromCandidate(candidate: DexTokenCandidateRecord): MemeSignalAnalysisRecord {
  return {
    postId: candidate.postId,
    status: "success",
    model: "stored-dex-refresh",
    promptVersion: "stored-dex-refresh",
    rawPayload: {},
    errorMessage: null,
    createdAt: candidate.createdAt,
    hasMemecoinSignal: true,
    signalScore: candidate.signalScore ?? 0,
    confidence: "medium",
    narrative: candidate.narrative ?? "",
    whySignal: candidate.whySignal ?? "",
    searchTerms: candidate.matchedTerms,
    possibleNames: [
      {
        name: candidate.baseTokenName,
        ticker: candidate.baseTokenSymbol,
        priority: candidate.matchScore,
        reason: "Previously identified DEX candidate."
      }
    ],
    entities: [],
    urgency: "medium",
    sensitivityFlags: [],
    recommendedAction: "watch"
  };
}

export class DexDiscoveryService {
  public constructor(
    private readonly config: Pick<
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
    >,
    private readonly repository: PostRepository,
    private readonly dexScreener: DexScreenerClient,
    private readonly logger: Logger,
    private readonly freeSecurityChecker: FreeTokenSecurityChecker | null = null,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async discoverPendingSignals(): Promise<DexDiscoveryRunSummary> {
    const refreshSummary = await this.refreshTrackedCandidates();
    const rugSummary = await this.refreshRugpullRisks();
    const signals = await this.repository.getSignalsPendingDexDiscovery({
      minScore: this.config.dexDiscoveryMinSignalScore,
      limit: this.config.dexDiscoveryMaxSignalsPerRun,
      ttlMinutes: this.config.dexDiscoveryCacheTtlMinutes
    });
    let analyzedSignalCount = 0;
    let candidateCount = 0;
    let highPriorityCount = refreshSummary.highPriorityCount;
    let errorCount = 0;

    for (const signal of signals) {
      const startedAt = this.now().toISOString();

      try {
        const terms = buildDexDiscoveryQueryTerms(signal, this.config.dexDiscoveryMaxQueriesPerSignal);
        const pairs: DexScreenerPair[] = [];
        for (const term of terms) {
          pairs.push(...await this.dexScreener.searchPairs(term));
        }

        const candidates = normalizeDexPairs(signal, terms, pairs, {
          minLiquidityUsd: this.config.dexDiscoveryMinLiquidityUsd,
          minVolume24hUsd: this.config.dexDiscoveryMinVolume24hUsd,
          now: this.now()
        });
        const scoredCandidates = await this.scoreAgainstStoredCandidates(signal.postId, candidates);
        await this.repository.upsertDexTokenCandidates(signal.postId, scoredCandidates);
        await this.repository.saveDexDiscoveryRun({
          postId: signal.postId,
          status: "success",
          startedAt,
          finishedAt: this.now().toISOString(),
          signalCount: 1,
          candidateCount: scoredCandidates.length,
          errorCount: 0,
          metadata: {
            queryTerms: terms
          }
        });

        analyzedSignalCount += 1;
        candidateCount += scoredCandidates.length;
        highPriorityCount += scoredCandidates.filter((candidate) => candidate.priorityScore >= 50).length;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown DEX discovery error";
        const run: DexDiscoveryRunInput = {
          postId: signal.postId,
          status: "error",
          startedAt,
          finishedAt: this.now().toISOString(),
          signalCount: 1,
          candidateCount: 0,
          errorCount: 1,
          errorMessage: message
        };
        await this.repository.saveDexDiscoveryRun(run);
        errorCount += 1;
        this.logger.warn("DEX discovery failed for signal", {
          postId: signal.postId,
          message
        });
      }
    }

    return {
      analyzedSignalCount,
      candidateCount,
      refreshedCandidateCount: refreshSummary.refreshedCandidateCount,
      highPriorityCount,
      rugCheckedCandidateCount: rugSummary.rugCheckedCandidateCount,
      highRugRiskCount: rugSummary.highRugRiskCount,
      errorCount
    };
  }

  private async scoreAgainstStoredCandidates(
    postId: string,
    candidates: DexTokenCandidateInput[]
  ): Promise<DexTokenCandidateInput[]> {
    if (candidates.length === 0) {
      return candidates;
    }

    const storedCandidates = await this.repository.getDexDiscoveryForPost(postId);
    const storedByPair = new Map(
      storedCandidates.map((candidate) => [
        `${candidate.chainId.toLowerCase()}:${candidate.pairAddress.toLowerCase()}`,
        candidate
      ])
    );

    return candidates.map((candidate) => {
      const stored = storedByPair.get(`${candidate.chainId.toLowerCase()}:${candidate.pairAddress.toLowerCase()}`) ?? null;
      const priority = scoreDexTokenPriority(candidate, stored, this.now());
      if (stored && stored.priorityScore > priority.priorityScore) {
        return {
          ...candidate,
          priorityScore: stored.priorityScore,
          priorityReasons: stored.priorityReasons
        };
      }

      return {
        ...candidate,
        priorityScore: priority.priorityScore,
        priorityReasons: priority.priorityReasons
      };
    });
  }

  private async refreshTrackedCandidates(): Promise<Pick<DexDiscoveryRunSummary, "refreshedCandidateCount" | "highPriorityCount">> {
    const staleCandidates = await this.repository.getDexCandidatesPendingRefresh({
      limit: this.config.dexCandidateRefreshLimit,
      ttlMinutes: this.config.dexCandidateRefreshTtlMinutes
    });
    let refreshedCandidateCount = 0;
    let highPriorityCount = 0;

    const candidatesByChain = new Map<string, DexTokenCandidateRecord[]>();
    for (const candidate of staleCandidates) {
      const existing = candidatesByChain.get(candidate.chainId) ?? [];
      existing.push(candidate);
      candidatesByChain.set(candidate.chainId, existing);
    }

    for (const [chainId, candidates] of candidatesByChain) {
      const candidateByPair = new Map(candidates.map((candidate) => [candidate.pairAddress.toLowerCase(), candidate]));

      for (const batch of chunks(candidates, 30)) {
        try {
          const pairs = await this.dexScreener.getPairsByChainAndAddresses(
            chainId,
            batch.map((candidate) => candidate.pairAddress)
          );
          const updatesByPostId = new Map<string, DexTokenCandidateInput[]>();

          for (const pair of pairs) {
            if (!pair.pairAddress) {
              continue;
            }

            const previousCandidate = candidateByPair.get(pair.pairAddress.toLowerCase());
            if (!previousCandidate) {
              continue;
            }

            const refreshedCandidate = buildDexTokenCandidate(
              signalFromCandidate(previousCandidate),
              pair,
              previousCandidate.matchedTerms,
              {
                minLiquidityUsd: this.config.dexDiscoveryMinLiquidityUsd,
                minVolume24hUsd: this.config.dexDiscoveryMinVolume24hUsd,
                duplicateSymbol: previousCandidate.riskFlags.includes("duplicate_symbol"),
                now: this.now()
              }
            );
            if (!refreshedCandidate) {
              continue;
            }

            const priority = scoreDexTokenPriority(refreshedCandidate, previousCandidate, this.now());
            const update = {
              ...refreshedCandidate,
              matchScore: Math.max(previousCandidate.matchScore, refreshedCandidate.matchScore),
              priorityScore: priority.priorityScore,
              priorityReasons: priority.priorityReasons
            };
            const postUpdates = updatesByPostId.get(previousCandidate.postId) ?? [];
            postUpdates.push(update);
            updatesByPostId.set(previousCandidate.postId, postUpdates);
          }

          for (const [postId, updates] of updatesByPostId) {
            await this.repository.upsertDexTokenCandidates(postId, updates);
            refreshedCandidateCount += updates.length;
            highPriorityCount += updates.filter((candidate) => candidate.priorityScore >= 50).length;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown DEX pair refresh error";
          this.logger.warn("DEX pair refresh failed", {
            chainId,
            pairCount: batch.length,
            message
          });
        }
      }
    }

    return {
      refreshedCandidateCount,
      highPriorityCount
    };
  }

  private async refreshRugpullRisks(): Promise<Pick<DexDiscoveryRunSummary, "rugCheckedCandidateCount" | "highRugRiskCount">> {
    const candidates = await this.repository.getDexCandidatesPendingRugCheck({
      limit: this.config.dexRugCheckLimit,
      ttlMinutes: this.config.dexRugCheckTtlMinutes
    });
    let rugCheckedCandidateCount = 0;
    let highRugRiskCount = 0;

    for (const candidate of candidates) {
      try {
        const freeSecurityChecks = this.freeSecurityChecker ? await this.freeSecurityChecker.check(candidate) : null;
        const risk = scoreDexRugpullRisk(candidate, this.now(), freeSecurityChecks);
        await this.repository.saveDexRugpullRisk(risk);
        rugCheckedCandidateCount += 1;
        if (risk.rugpullScore >= 50) {
          highRugRiskCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown DEX rug-risk error";
        this.logger.warn("DEX rug-risk check failed", {
          postId: candidate.postId,
          chainId: candidate.chainId,
          pairAddress: candidate.pairAddress,
          message
        });
      }
    }

    return {
      rugCheckedCandidateCount,
      highRugRiskCount
    };
  }
}
