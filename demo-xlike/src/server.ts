/**
 * X-like Server — Simple text posting site.
 * @progmune-generated session=xlike-manual timestamp=2026-06-21
 *
 * Routes:
 *   POST /api/posts       — create a post
 *   GET  /api/posts       — list recent posts
 *   GET  /api/posts/:id   — get post by ID
 *   DELETE /api/posts/:id — delete post by ID
 *   Static files served from ../public
 */

import express from "express";
import * as path from "path";
import {
  initDatabase,
  insertPost,
  getRecentPosts,
  getPostById,
  deletePost,
  getPostCount,
} from "./database";
import {
  validatePostContent,
  validateUsername,
  sendJSON,
  sendError,
  parseBody,
} from "./utils";

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Static frontend
app.use(express.static(path.resolve(__dirname, "..", "public")));

// ── API Routes ──

/** POST /api/posts — create a new text post */
app.post("/api/posts", (req, res) => {
  const body = parseBody(req) as Record<string, unknown> | undefined;
  if (!body) {
    return sendError(res, "Request body is required", 400);
  }

  const usernameCheck = validateUsername(body.username);
  if (!usernameCheck.valid) {
    return sendError(res, usernameCheck.error, 400);
  }

  const contentCheck = validatePostContent(body.content);
  if (!contentCheck.valid) {
    return sendError(res, contentCheck.error, 400);
  }

  const id = insertPost(usernameCheck.username, contentCheck.content);
  const post = getPostById(id);

  sendJSON(res, post, 201);
});

/** GET /api/posts — list recent posts */
app.get("/api/posts", (req, res) => {
  const limitParam = req.query.limit;
  let limit = 50;
  if (typeof limitParam === "string") {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  const posts = getRecentPosts(limit);
  const total = getPostCount();

  sendJSON(res, { posts, total, limit });
});

/** GET /api/posts/:id — get a single post */
app.get("/api/posts/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return sendError(res, "Invalid post ID", 400);
  }

  const post = getPostById(id);
  if (!post) {
    return sendError(res, "Post not found", 404);
  }

  sendJSON(res, post);
});

/** DELETE /api/posts/:id — delete a post */
app.delete("/api/posts/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return sendError(res, "Invalid post ID", 400);
  }

  const deleted = deletePost(id);
  if (!deleted) {
    return sendError(res, "Post not found", 404);
  }

  sendJSON(res, { deleted: true });
});

// ── Start ──
initDatabase();
app.listen(PORT, () => {
  console.log(`X-like server running on http://localhost:${PORT}`);
});

export default app;
