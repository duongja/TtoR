export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function formatMetadata(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(metadata)}`;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_ORDER[level];

  function write(currentLevel: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (LEVEL_ORDER[currentLevel] < threshold) {
      return;
    }

    const line = `${new Date().toISOString()} ${currentLevel.toUpperCase()} ${message}${formatMetadata(
      metadata
    )}`;

    if (currentLevel === "error") {
      console.error(line);
    } else if (currentLevel === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, metadata) => write("debug", message, metadata),
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata)
  };
}
