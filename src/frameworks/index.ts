/**
 * Progmune Framework Adapters
 *
 * Framework-specific protocol detection that complements the generic
 * \w* regex patterns in protocol-detector.ts.
 *
 * Each adapter knows the API surface of a specific framework:
 * middleware chains, route handlers, dependency injection, guards, etc.
 *
 * Adapters: Express, tRPC, NestJS(partial), FastAPI, Django, Flask, Fastify,
 * Next.js (App Router) — 7 dedicated detectors.
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

export { analyzeFastapiStructure } from "./fastapi-detector";
export type { FastapiStructure, FastapiSecurityIssue } from "./fastapi-detector";

export { analyzeDjangoStructure } from "./django-detector";
export type { DjangoStructure, DjangoSecurityIssue } from "./django-detector";

export { analyzeFlaskStructure } from "./flask-detector";
export type { FlaskStructure, FlaskSecurityIssue } from "./flask-detector";

export { analyzeFastifyApp, analyzeFastifyFile } from "./fastify-detector";
export type { FastifyAppAnalysis, FastifySecurityIssue } from "./fastify-detector";

export { analyzeNextApp, readNextMiddleware } from "./nextjs-detector";

export { analyzeKoaApp, analyzeKoaFile } from "./koa-detector";
export type { KoaAppAnalysis, KoaSecurityIssue } from "./koa-detector";

export { analyzeHapiApp, analyzeHapiFile } from "./hapi-detector";
export type { HapiAppAnalysis, HapiSecurityIssue } from "./hapi-detector";

export { analyzeGinApp, analyzeGinFile } from "./gin-detector";
export type { GinAppAnalysis, GinSecurityIssue } from "./gin-detector";

export { analyzeFiberApp, analyzeFiberFile } from "./fiber-detector";
export type { FiberAppAnalysis, FiberSecurityIssue } from "./fiber-detector";

export { analyzeNestJSProject, analyzeNestJSFile } from "./nestjs-detector";
export type { NestJSAnalysis, NestJSRoute, NestJSSecurityIssue } from "./nestjs-detector";
export type { NextAppAnalysis, NextSecurityIssue, NextRouteFile } from "./nextjs-detector";

// ── Framework Version-Aware Governance ──

export {
  detectFrameworks,
  checkFrameworkConventions,
  checkFileRename,
  generateVersionAwarenessReport,
} from "./version-awareness";

export type {
  FrameworkInfo,
  ConventionCheck,
} from "./version-awareness";
