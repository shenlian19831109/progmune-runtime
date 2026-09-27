"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVersionAwarenessReport = exports.checkFileRename = exports.checkFrameworkConventions = exports.detectFrameworks = exports.analyzeNestJSFile = exports.analyzeNestJSProject = exports.analyzeFiberFile = exports.analyzeFiberApp = exports.analyzeGinFile = exports.analyzeGinApp = exports.analyzeHapiFile = exports.analyzeHapiApp = exports.analyzeKoaFile = exports.analyzeKoaApp = exports.readNextMiddleware = exports.analyzeNextApp = exports.analyzeFastifyFile = exports.analyzeFastifyApp = exports.analyzeFlaskStructure = exports.analyzeDjangoStructure = exports.analyzeFastapiStructure = exports.formatExpressReport = exports.classifyMiddleware = exports.extractGlobalMiddleware = exports.extractRoutes = exports.detectExpressApp = exports.analyzeExpressProject = exports.analyzeExpressFile = exports.analyzeExpressApp = void 0;
var express_detector_1 = require("./express-detector");
Object.defineProperty(exports, "analyzeExpressApp", { enumerable: true, get: function () { return express_detector_1.analyzeExpressApp; } });
Object.defineProperty(exports, "analyzeExpressFile", { enumerable: true, get: function () { return express_detector_1.analyzeExpressFile; } });
Object.defineProperty(exports, "analyzeExpressProject", { enumerable: true, get: function () { return express_detector_1.analyzeExpressProject; } });
Object.defineProperty(exports, "detectExpressApp", { enumerable: true, get: function () { return express_detector_1.detectExpressApp; } });
Object.defineProperty(exports, "extractRoutes", { enumerable: true, get: function () { return express_detector_1.extractRoutes; } });
Object.defineProperty(exports, "extractGlobalMiddleware", { enumerable: true, get: function () { return express_detector_1.extractGlobalMiddleware; } });
Object.defineProperty(exports, "classifyMiddleware", { enumerable: true, get: function () { return express_detector_1.classifyMiddleware; } });
Object.defineProperty(exports, "formatExpressReport", { enumerable: true, get: function () { return express_detector_1.formatExpressReport; } });
var fastapi_detector_1 = require("./fastapi-detector");
Object.defineProperty(exports, "analyzeFastapiStructure", { enumerable: true, get: function () { return fastapi_detector_1.analyzeFastapiStructure; } });
var django_detector_1 = require("./django-detector");
Object.defineProperty(exports, "analyzeDjangoStructure", { enumerable: true, get: function () { return django_detector_1.analyzeDjangoStructure; } });
var flask_detector_1 = require("./flask-detector");
Object.defineProperty(exports, "analyzeFlaskStructure", { enumerable: true, get: function () { return flask_detector_1.analyzeFlaskStructure; } });
var fastify_detector_1 = require("./fastify-detector");
Object.defineProperty(exports, "analyzeFastifyApp", { enumerable: true, get: function () { return fastify_detector_1.analyzeFastifyApp; } });
Object.defineProperty(exports, "analyzeFastifyFile", { enumerable: true, get: function () { return fastify_detector_1.analyzeFastifyFile; } });
var nextjs_detector_1 = require("./nextjs-detector");
Object.defineProperty(exports, "analyzeNextApp", { enumerable: true, get: function () { return nextjs_detector_1.analyzeNextApp; } });
Object.defineProperty(exports, "readNextMiddleware", { enumerable: true, get: function () { return nextjs_detector_1.readNextMiddleware; } });
var koa_detector_1 = require("./koa-detector");
Object.defineProperty(exports, "analyzeKoaApp", { enumerable: true, get: function () { return koa_detector_1.analyzeKoaApp; } });
Object.defineProperty(exports, "analyzeKoaFile", { enumerable: true, get: function () { return koa_detector_1.analyzeKoaFile; } });
var hapi_detector_1 = require("./hapi-detector");
Object.defineProperty(exports, "analyzeHapiApp", { enumerable: true, get: function () { return hapi_detector_1.analyzeHapiApp; } });
Object.defineProperty(exports, "analyzeHapiFile", { enumerable: true, get: function () { return hapi_detector_1.analyzeHapiFile; } });
var gin_detector_1 = require("./gin-detector");
Object.defineProperty(exports, "analyzeGinApp", { enumerable: true, get: function () { return gin_detector_1.analyzeGinApp; } });
Object.defineProperty(exports, "analyzeGinFile", { enumerable: true, get: function () { return gin_detector_1.analyzeGinFile; } });
var fiber_detector_1 = require("./fiber-detector");
Object.defineProperty(exports, "analyzeFiberApp", { enumerable: true, get: function () { return fiber_detector_1.analyzeFiberApp; } });
Object.defineProperty(exports, "analyzeFiberFile", { enumerable: true, get: function () { return fiber_detector_1.analyzeFiberFile; } });
var nestjs_detector_1 = require("./nestjs-detector");
Object.defineProperty(exports, "analyzeNestJSProject", { enumerable: true, get: function () { return nestjs_detector_1.analyzeNestJSProject; } });
Object.defineProperty(exports, "analyzeNestJSFile", { enumerable: true, get: function () { return nestjs_detector_1.analyzeNestJSFile; } });
// ── Framework Version-Aware Governance ──
var version_awareness_1 = require("./version-awareness");
Object.defineProperty(exports, "detectFrameworks", { enumerable: true, get: function () { return version_awareness_1.detectFrameworks; } });
Object.defineProperty(exports, "checkFrameworkConventions", { enumerable: true, get: function () { return version_awareness_1.checkFrameworkConventions; } });
Object.defineProperty(exports, "checkFileRename", { enumerable: true, get: function () { return version_awareness_1.checkFileRename; } });
Object.defineProperty(exports, "generateVersionAwarenessReport", { enumerable: true, get: function () { return version_awareness_1.generateVersionAwarenessReport; } });
