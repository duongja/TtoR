import type { ErrorCode, HealthSnapshot, HealthStatus, PollRunRecord } from "./types.js";

function resolveLoginState(errorCode: ErrorCode | null): "valid" | "expired" | "unknown" {
  if (errorCode === "LOGIN_REQUIRED") {
    return "expired";
  }
  if (errorCode === null) {
    return "valid";
  }
  return "unknown";
}

export function computeHealthStatus(args: {
  targetHandle: string;
  latestPostId: string | null;
  latestPoll: PollRunRecord | null;
  latestSuccessfulPoll: PollRunRecord | null;
  now: Date;
  unhealthyAfterMs?: number;
}): HealthSnapshot {
  const unhealthyAfterMs = args.unhealthyAfterMs ?? 10 * 60 * 1000;
  const latestPoll = args.latestPoll;
  const latestSuccessfulPoll = args.latestSuccessfulPoll;

  let status: HealthStatus = "healthy";
  const lastErrorCode = latestPoll?.errorCode ?? null;

  if (!latestSuccessfulPoll) {
    status = "unhealthy";
  } else {
    const ageMs = args.now.getTime() - new Date(latestSuccessfulPoll.finishedAt).getTime();

    if (ageMs > unhealthyAfterMs) {
      status = "unhealthy";
    } else if (lastErrorCode === "LOGIN_REQUIRED" || latestPoll?.status === "error") {
      status = "degraded";
    }
  }

  return {
    status,
    targetHandle: args.targetHandle,
    lastSuccessfulPollAt: latestSuccessfulPoll?.finishedAt ?? null,
    lastPollAt: latestPoll?.finishedAt ?? null,
    latestPostId: args.latestPostId,
    lastErrorCode,
    loginState: resolveLoginState(lastErrorCode)
  };
}
