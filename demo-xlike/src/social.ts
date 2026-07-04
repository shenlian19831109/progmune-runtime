/**
 * Social module — AI-generated follow + like + notifications.
 *
 * Protocol: Resource Lifecycle
 *   follow_user → (interact) → unfollow_user
 *   like_post → unlike_post
 *
 * @protocol resource
 *   follow_user: pre_states=[] post_states=["FOLLOWING"]
 *   unfollow_user: pre_states=["FOLLOWING"] post_states=[] invalidate=["FOLLOWING"]
 *   like_post: pre_states=["POST_EXISTS"] post_states=["LIKED"]
 *   unlike_post: pre_states=["LIKED"] post_states=[] invalidate=["LIKED"]
 * @progmune-generated
 */

import { get_post } from "./posts";

// ── Follow System ──

const followers: Map<string, Set<string>> = new Map(); // userId → followerIds
const following: Map<string, Set<string>> = new Map(); // userId → followingIds

export function follow_user(followerId: string, targetUserId: string): boolean {
  if (followerId === targetUserId) return false;

  if (!followers.has(targetUserId)) followers.set(targetUserId, new Set());
  followers.get(targetUserId)!.add(followerId);

  if (!following.has(followerId)) following.set(followerId, new Set());
  following.get(followerId)!.add(targetUserId);

  addNotification(targetUserId, "You have a new follower!");
  return true;
}

export function unfollow_user(followerId: string, targetUserId: string): boolean {
  followers.get(targetUserId)?.delete(followerId);
  following.get(followerId)?.delete(targetUserId);
  return true;
}

export function get_followers(userId: string): string[] {
  return [...(followers.get(userId) || [])];
}

export function get_following(userId: string): string[] {
  return [...(following.get(userId) || [])];
}

// ── Like System ──

const postLikes: Map<string, Set<string>> = new Map(); // postId → userIds

export function like_post(userId: string, postId: string): boolean {
  const post = get_post(postId);
  if (!post) return false;

  if (!postLikes.has(postId)) postLikes.set(postId, new Set());
  if (postLikes.get(postId)!.has(userId)) return false; // already liked

  postLikes.get(postId)!.add(userId);
  post.likeCount = (post.likeCount || 0) + 1;

  if (post.userId !== userId) {
    addNotification(post.userId, "Someone liked your post!");
  }
  return true;
}

export function unlike_post(userId: string, postId: string): boolean {
  const post = get_post(postId);
  if (!post) return false;

  postLikes.get(postId)?.delete(userId);
  post.likeCount = Math.max(0, (post.likeCount || 1) - 1);
  return true;
}

export function get_likes(postId: string): number {
  return postLikes.get(postId)?.size || 0;
}

// ── Notifications ──

interface Notification {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: number;
}

const notifications: Map<string, Notification[]> = new Map();

export function addNotification(userId: string, message: string): void {
  if (!notifications.has(userId)) notifications.set(userId, []);
  notifications.get(userId)!.push({
    id: Math.random().toString(36).slice(2),
    userId,
    message,
    read: false,
    createdAt: Date.now(),
  });
}

export function getNotifications(userId: string): Notification[] {
  return (notifications.get(userId) || []).sort((a, b) => b.createdAt - a.createdAt);
}

export function markNotificationsRead(userId: string): void {
  (notifications.get(userId) || []).forEach(n => (n.read = true));
}

// ── AI-GENERATED BUG: follow without notification ──

/**
 * BUG: Follows user but doesn't send notification.
 * Progmune INFO: functional but missing user experience — no notification.
 *
 * @progmune-detected: missing addNotification after follow_user
 */
export function silentFollow(followerId: string, targetUserId: string): boolean {
  if (followerId === targetUserId) return false;
  if (!followers.has(targetUserId)) followers.set(targetUserId, new Set());
  followers.get(targetUserId)!.add(followerId);
  if (!following.has(followerId)) following.set(followerId, new Set());
  following.get(followerId)!.add(targetUserId);
  // BUG: No notification sent — user won't know they gained a follower
  return true;
}
