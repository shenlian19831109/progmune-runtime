/**
 * Comments module — AI-generated comment system.
 *
 * Protocol: Resource Lifecycle
 *   create_comment → (read_comments) → delete_comment
 *
 * Constraint: comment must reference a valid post.
 *
 * @protocol resource
 *   create_comment: pre_states=["POST_EXISTS"] post_states=["COMMENT_CREATED"]
 *   delete_comment: pre_states=["COMMENT_CREATED"] post_states=[] invalidate=["COMMENT_CREATED"]
 * @progmune-generated
 */

import * as crypto from "crypto";
import type { User } from "./auth";
import { get_post } from "./posts";
import { addNotification } from "./social";

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: number;
}

const comments: Map<string, Comment> = new Map();
const postComments: Map<string, Set<string>> = new Map(); // postId → commentIds

// ── Create Comment ──

export function create_comment(user: User, postId: string, content: string): Comment {
  // Validate post exists
  const post = get_post(postId);
  if (!post) {
    throw new Error("Post not found");
  }

  if (!content || content.trim().length === 0) {
    throw new Error("Comment cannot be empty");
  }

  const comment: Comment = {
    id: crypto.randomBytes(10).toString("hex"),
    postId,
    userId: user.id,
    username: user.username,
    content: content.trim(),
    createdAt: Date.now(),
  };

  comments.set(comment.id, comment);

  if (!postComments.has(postId)) {
    postComments.set(postId, new Set());
  }
  postComments.get(postId)!.add(comment.id);

  // Update post comment count
  post.commentCount = (post.commentCount || 0) + 1;

  // Notify post author
  if (post.userId !== user.id) {
    addNotification(post.userId, `${user.username} commented on your post`);
  }

  return comment;
}

// ── Read Comments ──

export function get_post_comments(postId: string): Comment[] {
  const commentIds = postComments.get(postId);
  if (!commentIds) return [];

  return [...commentIds]
    .map(id => comments.get(id))
    .filter((c): c is Comment => c !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ── Delete Comment ──

export function delete_comment(userId: string, commentId: string): boolean {
  const comment = comments.get(commentId);
  if (!comment || comment.userId !== userId) return false;

  comments.delete(commentId);
  postComments.get(comment.postId)?.delete(commentId);

  // Update post comment count
  const post = get_post(comment.postId);
  if (post) post.commentCount = Math.max(0, (post.commentCount || 1) - 1);

  return true;
}

// ── AI-GENERATED BUG: comment on non-existent post ──

/**
 * BUG: Creates comment without checking if post exists.
 * Progmune BLOCK: references non-existent resource.
 *
 * @progmune-detected: missing post existence check before create_comment
 */
export function unsafeComment(user: User, postId: string, content: string): Comment {
  // BUG: No post existence check — could reference deleted/non-existent post
  const comment: Comment = {
    id: crypto.randomBytes(10).toString("hex"),
    postId,
    userId: user.id,
    username: user.username,
    content,
    createdAt: Date.now(),
  };
  comments.set(comment.id, comment);
  return comment;
}
