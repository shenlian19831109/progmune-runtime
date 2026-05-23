"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.withLock = withLock;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * 基于目录原子性的轻量级文件锁
 * mkdir 在系统层面是原子操作，用锁目录的存在与否表示锁定状态
 */
const LOCK_DIR = path.resolve(__dirname, "../.locks");
function ensureLockDir() {
    if (!fs.existsSync(LOCK_DIR))
        fs.mkdirSync(LOCK_DIR, { recursive: true });
}
function lockPath(name) {
    return path.join(LOCK_DIR, name.replace(/[^a-zA-Z0-9_\-\.]/g, "_"));
}
function withLock(name, fn) {
    ensureLockDir();
    const lock = lockPath(name);
    const maxRetries = 100;
    const retryDelay = 5; // ms
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            fs.mkdirSync(lock);
            // 获取锁成功
            try {
                return fn();
            }
            finally {
                try {
                    fs.rmdirSync(lock);
                }
                catch { }
            }
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
            // 锁被占用，等待重试
            if (attempt < maxRetries - 1) {
                // busy-wait，但每次最多 5ms × 100 = 500ms
                const start = Date.now();
                while (Date.now() - start < retryDelay) { }
            }
        }
    }
    throw new Error(`无法获取锁: ${name} (超过最大重试次数 ${maxRetries})`);
}
