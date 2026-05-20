export type PollRunStatus = "success" | "error";

export type ErrorCode =
  | "LOGIN_REQUIRED"
  | "TIMELINE_NOT_FOUND"
  | "PARSE_FAILED"
  | "NAVIGATION_FAILED"
  | "UNKNOWN";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface MediaAsset {
  kind: "image" | "video";
  url: string;
  alt: string | null;
}

export interface NormalizedPost {
  postId: string;
  authorHandle: string;
  authorDisplayName: string | null;
  createdAt: string | null;
  detectedAt: string;
  text: string;
  lang: string | null;
  conversationId: string | null;
  replyToPostId: string | null;
  quotedPostId: string | null;
  isRepost: boolean;
  media: MediaAsset[];
  rawPayload: Record<string, unknown>;
}

export interface PollRunRecord {
  id: number;
  startedAt: string;
  finishedAt: string;
  status: PollRunStatus;
  newPostsCount: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  latestPostId: string | null;
  metadata: Record<string, unknown>;
}

export interface PollRunInput {
  startedAt: string;
  finishedAt: string;
  status: PollRunStatus;
  posts?: NormalizedPost[];
  errorCode?: ErrorCode | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StoredPost extends NormalizedPost {
  insertedAt: string;
}

export type MemeSignalConfidence = "low" | "medium" | "high";
export type MemeSignalUrgency = "low" | "medium" | "high";
export type MemeSignalRecommendedAction = "ignore" | "watch" | "search" | "urgent_search";
export type MemeSignalStatus = "success" | "error";

export interface MemeSignalName {
  name: string;
  ticker: string;
  priority: number;
  reason: string;
}

export interface MemeSignalAnalysisPayload {
  hasMemecoinSignal: boolean;
  signalScore: number;
  confidence: MemeSignalConfidence;
  narrative: string;
  whySignal: string;
  searchTerms: string[];
  possibleNames: MemeSignalName[];
  entities: string[];
  urgency: MemeSignalUrgency;
  sensitivityFlags: string[];
  recommendedAction: MemeSignalRecommendedAction;
}

export interface MemeSignalAnalysisRecord extends MemeSignalAnalysisPayload {
  postId: string;
  status: MemeSignalStatus;
  model: string;
  promptVersion: string;
  rawPayload: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
}

export interface MemeSignalAnalysisInput {
  postId: string;
  status: MemeSignalStatus;
  model: string;
  promptVersion: string;
  analysis?: MemeSignalAnalysisPayload;
  rawPayload?: Record<string, unknown>;
  errorMessage?: string | null;
  createdAt: string;
}

export type DexDiscoveryStatus = "success" | "error";

export type DexTokenCandidateRiskFlag =
  | "low_liquidity"
  | "low_volume"
  | "new_pair"
  | "missing_socials"
  | "duplicate_symbol"
  | "high_fdv_low_liquidity";

export type DexTokenCandidatePriorityReason =
  | "strong_volume"
  | "strong_liquidity"
  | "fresh_launch"
  | "price_up_since_last_check"
  | "volume_up_since_last_check"
  | "liquidity_up_since_last_check"
  | "price_up_since_discovery"
  | "volume_up_since_discovery"
  | "liquidity_up_since_discovery";

export type DexRugpullLevel = "low" | "medium" | "high" | "critical";
export type DexRugpullTrend = "improving" | "stable" | "worsening";

export type DexRugpullFlag =
  | "critical_liquidity"
  | "low_liquidity"
  | "liquidity_collapse"
  | "liquidity_drop"
  | "extreme_fdv_liquidity"
  | "high_fdv_liquidity"
  | "extreme_volume_liquidity"
  | "high_volume_liquidity"
  | "price_collapse"
  | "dex_price_crash"
  | "sell_buy_imbalance"
  | "buy_sell_imbalance"
  | "missing_socials"
  | "duplicate_symbol"
  | "very_new_pair"
  | "new_pair"
  | "high_fdv_low_liquidity"
  | "mint_authority_enabled"
  | "freeze_authority_enabled"
  | "top_holder_concentration"
  | "top10_holder_concentration";

export interface DexRugpullDetail {
  flag: DexRugpullFlag;
  severity: DexRugpullLevel;
  points: number;
  description: string;
}

export interface DexRugpullRiskInput {
  postId: string;
  chainId: string;
  pairAddress: string;
  baseTokenAddress: string;
  rugpullScore: number;
  previousRugpullScore: number | null;
  rugpullLevel: DexRugpullLevel;
  rugpullTrend: DexRugpullTrend;
  rugpullFlags: DexRugpullFlag[];
  rugpullDetails: DexRugpullDetail[];
  rawPayload: Record<string, unknown>;
  checkedAt: string;
}

export interface DexRugpullRiskSnapshotRecord extends DexRugpullRiskInput {
  id: number;
}

export interface DexDiscoveryRunInput {
  postId: string;
  status: DexDiscoveryStatus;
  startedAt: string;
  finishedAt: string;
  signalCount: number;
  candidateCount: number;
  errorCount: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DexDiscoveryRunRecord extends DexDiscoveryRunInput {
  id: number;
}

export interface DexTokenCandidateInput {
  postId: string;
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseTokenAddress: string;
  baseTokenName: string;
  baseTokenSymbol: string;
  quoteTokenSymbol: string | null;
  url: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  pairCreatedAt: string | null;
  matchScore: number;
  riskFlags: DexTokenCandidateRiskFlag[];
  matchedTerms: string[];
  rawPayload: Record<string, unknown>;
  discoveredAt: string;
  lastCheckedAt: string;
  priorityScore: number;
  priorityReasons: DexTokenCandidatePriorityReason[];
  rugpullScore?: number;
  previousRugpullScore?: number | null;
  rugpullLevel?: DexRugpullLevel;
  rugpullFlags?: DexRugpullFlag[];
  rugpullDetails?: DexRugpullDetail[];
  rugpullTrend?: DexRugpullTrend;
  lastRugCheckedAt?: string | null;
}

export interface DexTokenCandidateRecord extends DexTokenCandidateInput {
  firstPriceUsd: number | null;
  firstLiquidityUsd: number | null;
  firstVolume24hUsd: number | null;
  previousPriceUsd: number | null;
  previousLiquidityUsd: number | null;
  previousVolume24hUsd: number | null;
  rugpullScore: number;
  previousRugpullScore: number | null;
  rugpullLevel: DexRugpullLevel;
  rugpullFlags: DexRugpullFlag[];
  rugpullDetails: DexRugpullDetail[];
  rugpullTrend: DexRugpullTrend;
  lastRugCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  signalScore: number | null;
  narrative: string | null;
  whySignal: string | null;
}

export interface HealthSnapshot {
  status: HealthStatus;
  targetHandle: string;
  lastSuccessfulPollAt: string | null;
  lastPollAt: string | null;
  latestPostId: string | null;
  lastErrorCode: ErrorCode | null;
  loginState: "valid" | "expired" | "unknown";
}

export interface ScrapeResult {
  posts: NormalizedPost[];
  loginExpired: boolean;
  extractedAt: string;
  sourceUrl: string;
  rawHtml: string;
  artifactPaths: string[];
}

export interface TimelineScraper {
  scrapeTimeline(handle: string): Promise<ScrapeResult>;
  close(): Promise<void>;
}

export interface PollCycleSummary {
  startedAt: string;
  finishedAt: string;
  status: PollRunStatus;
  newPostsCount: number;
  latestPostId: string | null;
  errorCode: ErrorCode | null;
  aiAnalyzedCount?: number;
  aiSignalCount?: number;
  aiErrorCount?: number;
}

export interface BackfillResult {
  posts: NormalizedPost[];
  startedAt: string;
  finishedAt: string;
  sourceUrl: string;
  since: string;
  pagesCaptured: number;
  scrolls: number;
  oldestPostAt: string | null;
  newestPostAt: string | null;
  stoppedReason: "reached_since" | "no_progress" | "max_scrolls" | "request_failed";
}
