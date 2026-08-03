/**
 * Progmune Framework Adapters
 *
 * Framework-specific protocol detection that complements the generic
 * \w* regex patterns in protocol-detector.ts.
 *
 * Each adapter knows the API surface of a specific framework:
 * middleware chains, route handlers, dependency injection, guards, etc.
 *
 * Current: Express.js (first adapter — broke the 0/13 gap)
 * Planned: Next.js, NestJS, Fastify, FastAPI, Django
 */

export {
  analyzeExpressApp,
  analyzeExpressFile,
  analyzeExpressProject,
  detectExpressApp,
  extractRoutes,
  extractGlobalMiddleware,
  classifyMiddleware,
  formatExpressReport,
} from "./express-detector";

export type {
  ExpressRoute,
  ExpressMiddlewareChain,
  ExpressAppAnalysis,
  ExpressSecurityIssue,
} from "./express-detector";
