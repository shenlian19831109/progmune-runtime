"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for logger.ts — structured logging.
 */
const vitest_1 = require("vitest");
const logger_1 = require("./logger");
(0, vitest_1.describe)("createLogger", () => {
    (0, vitest_1.it)("creates a logger with all log methods", () => {
        const log = (0, logger_1.createLogger)("test");
        (0, vitest_1.expect)(typeof log.debug).toBe("function");
        (0, vitest_1.expect)(typeof log.info).toBe("function");
        (0, vitest_1.expect)(typeof log.warn).toBe("function");
        (0, vitest_1.expect)(typeof log.error).toBe("function");
    });
    (0, vitest_1.it)("returns a different logger per module name", () => {
        const a = (0, logger_1.createLogger)("module-a");
        const b = (0, logger_1.createLogger)("module-b");
        (0, vitest_1.expect)(a).not.toBe(b);
    });
    (0, vitest_1.it)("log methods accept message and optional data", () => {
        const log = (0, logger_1.createLogger)("test");
        // Should not throw
        log.info("hello");
        log.info("with data", { key: "value" });
        log.warn("warning");
        log.error("error", new Error("boom"));
        log.debug("debug message");
    });
    (0, vitest_1.it)("loggers are callable without throwing", () => {
        const log = (0, logger_1.createLogger)("safety");
        (0, vitest_1.expect)(() => log.info("msg")).not.toThrow();
        (0, vitest_1.expect)(() => log.warn("msg")).not.toThrow();
        (0, vitest_1.expect)(() => log.error("msg")).not.toThrow();
        (0, vitest_1.expect)(() => log.debug("msg")).not.toThrow();
    });
});
