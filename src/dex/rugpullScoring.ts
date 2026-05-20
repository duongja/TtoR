import type {
  DexRugpullDetail,
  DexRugpullFlag,
  DexRugpullLevel,
  DexRugpullRiskInput,
  DexRugpullTrend,
  DexTokenCandidateRecord
} from "../types.js";
import type { FreeTokenSecurityCheckResult } from "./freeSecurityChecks.js";

type CandidateRiskView = Pick<
  DexTokenCandidateRecord,
  | "postId"
  | "chainId"
  | "pairAddress"
  | "baseTokenAddress"
  | "priceUsd"
  | "liquidityUsd"
  | "volume24hUsd"
  | "fdv"
  | "pairCreatedAt"
  | "riskFlags"
  | "previousPriceUsd"
  | "previousLiquidityUsd"
  | "rugpullScore"
  | "lastRugCheckedAt"
  | "rawPayload"
>;

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function percentDrop(current: number | null, previous: number | null): number {
  if (current === null || previous === null || previous <= 0) {
    return 0;
  }

  return Math.max(0, (previous - current) / previous);
}

function pairAgeHours(pairCreatedAt: string | null, now: Date): number | null {
  if (!pairCreatedAt) {
    return null;
  }

  const parsed = Date.parse(pairCreatedAt);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, (now.getTime() - parsed) / 3_600_000);
}

function detail(flag: DexRugpullFlag, severity: DexRugpullLevel, points: number, description: string): DexRugpullDetail {
  return {
    flag,
    severity,
    points,
    description
  };
}

function scoreToLevel(score: number): DexRugpullLevel {
  if (score >= 75) {
    return "critical";
  }
  if (score >= 50) {
    return "high";
  }
  if (score >= 25) {
    return "medium";
  }
  return "low";
}

function scoreToTrend(score: number, previousScore: number | null): DexRugpullTrend {
  if (previousScore === null) {
    return "stable";
  }

  const delta = score - previousScore;
  if (delta >= 10) {
    return "worsening";
  }
  if (delta <= -10) {
    return "improving";
  }
  return "stable";
}

function rawNestedNumber(rawPayload: Record<string, unknown>, path: string[]): number | null {
  let current: unknown = rawPayload;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === "number" && Number.isFinite(current)) {
    return current;
  }
  if (typeof current === "string") {
    const parsed = Number.parseFloat(current);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function scoreDexRugpullRisk(
  candidate: CandidateRiskView,
  now: Date,
  freeSecurityChecks: FreeTokenSecurityCheckResult | null = null
): DexRugpullRiskInput {
  const details: DexRugpullDetail[] = [...(freeSecurityChecks?.findings.map((finding) => finding.detail) ?? [])];
  const liquidityUsd = candidate.liquidityUsd;
  const volume24hUsd = candidate.volume24hUsd;
  const fdv = candidate.fdv;
  const previousRugpullScore = candidate.lastRugCheckedAt && Number.isFinite(candidate.rugpullScore)
    ? candidate.rugpullScore
    : null;

  if ((liquidityUsd ?? 0) < 1_000) {
    details.push(detail("critical_liquidity", "critical", 35, "Liquidity is below $1k."));
  } else if ((liquidityUsd ?? 0) < 5_000) {
    details.push(detail("low_liquidity", "high", 20, "Liquidity is below $5k."));
  }

  const liquidityDrop = percentDrop(liquidityUsd, candidate.previousLiquidityUsd);
  if (liquidityDrop > 0.7) {
    details.push(detail("liquidity_collapse", "critical", 40, "Liquidity dropped more than 70% since the previous check."));
  } else if (liquidityDrop > 0.5) {
    details.push(detail("liquidity_drop", "high", 25, "Liquidity dropped more than 50% since the previous check."));
  }

  const fdvLiquidityRatio = ratio(fdv, liquidityUsd);
  if (fdvLiquidityRatio !== null && fdvLiquidityRatio > 500) {
    details.push(detail("extreme_fdv_liquidity", "critical", 35, "FDV is more than 500x available liquidity."));
  } else if (fdvLiquidityRatio !== null && fdvLiquidityRatio > 100) {
    details.push(detail("high_fdv_liquidity", "high", 20, "FDV is more than 100x available liquidity."));
  }

  const volumeLiquidityRatio = ratio(volume24hUsd, liquidityUsd);
  if (volumeLiquidityRatio !== null && volumeLiquidityRatio > 50) {
    details.push(detail("extreme_volume_liquidity", "high", 25, "24h volume is more than 50x liquidity."));
  } else if (volumeLiquidityRatio !== null && volumeLiquidityRatio > 20) {
    details.push(detail("high_volume_liquidity", "medium", 15, "24h volume is more than 20x liquidity."));
  }

  if (percentDrop(candidate.priceUsd, candidate.previousPriceUsd) > 0.5) {
    details.push(detail("price_collapse", "high", 20, "Price dropped more than 50% since the previous check."));
  }

  const priceChangeH1 = rawNestedNumber(candidate.rawPayload, ["priceChange", "h1"]);
  const buysH1 = rawNestedNumber(candidate.rawPayload, ["txns", "h1", "buys"]);
  const sellsH1 = rawNestedNumber(candidate.rawPayload, ["txns", "h1", "sells"]);
  if (priceChangeH1 !== null && priceChangeH1 <= -60) {
    details.push(detail("dex_price_crash", "high", 20, "DexScreener reports a price drop over 60% in the last hour."));
  }
  if (buysH1 !== null && sellsH1 !== null && buysH1 >= 10 && sellsH1 / Math.max(1, buysH1) >= 4) {
    details.push(detail("sell_buy_imbalance", "high", 15, "Recent sell transactions are more than 4x buys."));
  }
  if (buysH1 !== null && sellsH1 !== null && sellsH1 >= 10 && buysH1 / Math.max(1, sellsH1) >= 8) {
    details.push(detail("buy_sell_imbalance", "medium", 10, "Recent buy transactions are far above sells, which may indicate one-sided trading."));
  }

  if (candidate.riskFlags.includes("missing_socials")) {
    details.push(detail("missing_socials", "medium", 10, "Token has no website or social links in DexScreener metadata."));
  }
  if (candidate.riskFlags.includes("duplicate_symbol")) {
    details.push(detail("duplicate_symbol", "medium", 8, "Multiple matched pairs share the same token symbol."));
  }
  if (candidate.riskFlags.includes("high_fdv_low_liquidity")) {
    details.push(detail("high_fdv_low_liquidity", "high", 25, "FDV is high while liquidity remains thin."));
  }

  const ageHours = pairAgeHours(candidate.pairCreatedAt, now);
  if (ageHours !== null && ageHours < 1) {
    details.push(detail("very_new_pair", "medium", 12, "Pair is less than one hour old."));
  } else if (ageHours !== null && ageHours <= 24) {
    details.push(detail("new_pair", "low", 6, "Pair is less than 24 hours old."));
  }

  const score = Math.max(0, Math.min(100, details.reduce((sum, item) => sum + item.points, 0)));
  const checkedAt = now.toISOString();

  return {
    postId: candidate.postId,
    chainId: candidate.chainId,
    pairAddress: candidate.pairAddress,
    baseTokenAddress: candidate.baseTokenAddress,
    rugpullScore: score,
    previousRugpullScore,
    rugpullLevel: scoreToLevel(score),
    rugpullTrend: scoreToTrend(score, previousRugpullScore),
    rugpullFlags: [...new Set(details.map((item) => item.flag))],
    rugpullDetails: details,
    rawPayload: {
      liquidityUsd,
      previousLiquidityUsd: candidate.previousLiquidityUsd,
      volume24hUsd,
      fdv,
      fdvLiquidityRatio,
      volumeLiquidityRatio,
      priceUsd: candidate.priceUsd,
      previousPriceUsd: candidate.previousPriceUsd,
      pairCreatedAt: candidate.pairCreatedAt,
      riskFlags: candidate.riskFlags,
      dexScreener: {
        priceChangeH1,
        buysH1,
        sellsH1
      },
      freeSecurityChecks: freeSecurityChecks?.rawPayload ?? null
    },
    checkedAt
  };
}
