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
