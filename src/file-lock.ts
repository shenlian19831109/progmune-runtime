import * as fs from "fs";
import * as path from "path";

/**
 * 基于目录原子性的轻量级文件锁
 * mkdir 在系统层面是原子操作，用锁目录的存在与否表示锁定状态
 */
const LOCK_DIR = path.resolve(__dirname, "../.locks");

function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function lockPath(name: string): string {
  return path.join(LOCK_DIR, name.replace(/[^a-zA-Z0-9_\-\.]/g, "_"));
}

export function withLock<T>(name: string, fn: () => T): T {
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
      } finally {
        try { fs.rmdirSync(lock); } catch { /* best-effort cleanup */ }
      }
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      // 锁被占用，等待重试
      if (attempt < maxRetries - 1) {
        // busy-wait，但每次最多 5ms × 100 = 500ms
        const start = Date.now();
        while (Date.now() - start < retryDelay) {}
      }
    }
  }
  throw new Error(`无法获取锁: ${name} (超过最大重试次数 ${maxRetries})`);
}
