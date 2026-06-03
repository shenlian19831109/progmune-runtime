/**
 * Structured logger for Progmune Runtime.
 *
 * Replaces raw console.* calls with leveled, module-scoped,
 * optionally JSON-formatted output.
 *
 * Environment variables:
 *   PROGMUNE_LOG_LEVEL  — debug | info | warn | error (default: info)
 *   PROGMUNE_LOG_JSON   — "true" for machine-readable JSON lines
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const minLevel = (process.env.PROGMUNE_LOG_LEVEL || "info") as Level;
const jsonMode = process.env.PROGMUNE_LOG_JSON === "true";

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatLine(level: Level, module: string, message: string, data?: unknown): string {
  if (jsonMode) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      module,
      message,
      ...(data !== undefined ? { data } : {}),
    };
    return JSON.stringify(entry);
  }

  const prefix: Record<Level, string> = {
    debug: "  ",
    info: "ℹ ",
    warn: "⚠ ",
    error: "❌",
  };
  const tag = `[${module}]`;
  const line = `${prefix[level]} ${tag} ${message}`;
  if (data !== undefined) {
    if (data instanceof Error) {
      return `${line}\n       ${data.stack || data.message}`;
    }
    return `${line} ${JSON.stringify(data)}`;
  }
  return line;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    debug(message, data) {
      if (shouldLog("debug")) console.error(formatLine("debug", module, message, data));
    },
    info(message, data) {
      if (shouldLog("info")) console.error(formatLine("info", module, message, data));
    },
    warn(message, data) {
      if (shouldLog("warn")) console.error(formatLine("warn", module, message, data));
    },
    error(message, data) {
      if (shouldLog("error")) console.error(formatLine("error", module, message, data));
    },
  };
}
