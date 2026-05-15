import type { ErrorCode } from "./types.js";

export class ScraperError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ScraperError";
    this.code = code;
    this.details = details;
  }
}

export function classifyError(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof ScraperError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message };
  }

  return { code: "UNKNOWN", message: "Unknown error" };
}
