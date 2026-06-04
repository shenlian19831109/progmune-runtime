/**
 * Unit tests for logger.ts — structured logging.
 */
import { describe, it, expect } from "vitest";
import { createLogger } from "./logger";
import type { Logger } from "./logger";

describe("createLogger", () => {
  it("creates a logger with all log methods", () => {
    const log = createLogger("test");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("returns a different logger per module name", () => {
    const a = createLogger("module-a");
    const b = createLogger("module-b");
    expect(a).not.toBe(b);
  });

  it("log methods accept message and optional data", () => {
    const log = createLogger("test");
    // Should not throw
    log.info("hello");
    log.info("with data", { key: "value" });
    log.warn("warning");
    log.error("error", new Error("boom"));
    log.debug("debug message");
  });

  it("loggers are callable without throwing", () => {
    const log: Logger = createLogger("safety");
    expect(() => log.info("msg")).not.toThrow();
    expect(() => log.warn("msg")).not.toThrow();
    expect(() => log.error("msg")).not.toThrow();
    expect(() => log.debug("msg")).not.toThrow();
  });
});
