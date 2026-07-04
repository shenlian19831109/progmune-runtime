/**
 * Posts module — AI-generated post CRUD.
 *
 * Protocol: Resource Lifecycle
 *   create_post → (read_post) → (optional: edit_post) → delete_post
 *
 * @protocol resource
 *   create_post: pre_states=[] post_states=["POST_CREATED"]
 *   delete_post: pre_states=["POST_CREATED"] post_states=[] invalidate=["POST_CREATED"]
 * @progmune-generated
 */

import * as crypto from "crypto";
import type { User } from "./auth";

export interface Post {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: number;
  editedAt?: number;
  likeCount: number;
  commentCount: number;
}

const posts: Map<string, Post> = new Map();
const userPosts: Map<string, Set<string>> = new Map(); // userId → postIds

// ── Create Post ──

export function create_post(user: User, content: string): Post {
  if (!content || content.trim().length === 0) {
    throw new Error("Content cannot be empty");
  }
  if (content.length > 280) {
    throw new Error("Content exceeds 280 characters");
  }

  const post: Post = {
    id: crypto.randomBytes(12).toString("hex"),
    userId: user.id,
    username: user.username,
    content: content.trim(),
    createdAt: Date.now(),
    likeCount: 0,
    commentCount: 0,
  };

  posts.set(post.id, post);

  if (!userPosts.has(user.id)) {
    userPosts.set(user.id, new Set());
  }
  userPosts.get(user.id)!.add(post.id);

  return post;
}

// ── Read Posts ──

export function get_post(postId: string): Post | null {
  return posts.get(postId) || null;
}

export function get_user_posts(userId: string): Post[] {
  const postIds = userPosts.get(userId);
  if (!postIds) return [];

  return [...postIds]
    .map(id => posts.get(id))
    .filter((p): p is Post => p !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function get_timeline(limit: number = 50): Post[] {
  return [...posts.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// ── Delete Post ──

export function delete_post(userId: string, postId: string): boolean {
  const post = posts.get(postId);
  if (!post || post.userId !== userId) return false;

  posts.delete(postId);
  userPosts.get(userId)?.delete(postId);
  return true;
}

// ── AI-GENERATED BUG: post without content validation ──

/**
 * BUG: Creates post without content validation.
 * Progmune WARN: empty content allowed — data integrity violation.
 *
 * @progmune-detected: missing content validation before create_post
 */
export function quickPost(user: User, content: string): Post {
  // BUG: No content validation — empty strings and >280 char allowed
  const post: Post = {
    id: crypto.randomBytes(12).toString("hex"),
    userId: user.id,
    username: user.username,
    content, // BUG: not trimmed, not validated
    createdAt: Date.now(),
    likeCount: 0,
    commentCount: 0,
  };
  posts.set(post.id, post);
  return post;
}
