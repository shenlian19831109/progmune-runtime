/**
 * Database layer — SQLite functions available to Progmune code generation.
 * These are the ONLY database functions the generated code can use.
 */

import Database from "better-sqlite3";
import * as path from "path";

const DB_PATH = path.resolve(__dirname, "..", "data", "xlike.db");

// Ensure data directory exists
import * as fs from "fs";
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL");

/** Initialize database tables */
export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
  `);
}

/** Insert a new post. Returns the new post ID. */
export function insertPost(username: string, content: string): number {
  const stmt = db.prepare("INSERT INTO posts (username, content) VALUES (?, ?)");
  const result = stmt.run(username, content);
  return Number(result.lastInsertRowid);
}

/** Get recent posts, newest first. */
export function getRecentPosts(limit: number = 50): Array<{
  id: number;
  username: string;
  content: string;
  created_at: string;
}> {
  const stmt = db.prepare("SELECT id, username, content, created_at FROM posts ORDER BY created_at DESC LIMIT ?");
  return stmt.all(limit) as any[];
}

/** Get a single post by ID. */
export function getPostById(id: number): {
  id: number;
  username: string;
  content: string;
  created_at: string;
} | undefined {
  const stmt = db.prepare("SELECT id, username, content, created_at FROM posts WHERE id = ?");
  return stmt.get(id) as any;
}

/** Delete a post by ID. Returns true if deleted. */
export function deletePost(id: number): boolean {
  const stmt = db.prepare("DELETE FROM posts WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/** Get total post count. */
export function getPostCount(): number {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM posts").get() as { cnt: number };
  return row.cnt;
}
