// Blog platform - comments module
import { getSessionUser } from "./auth";

interface Comment { id: string; postId: string; content: string; authorId: string; createdAt: number; }
const comments: Comment[] = [];

export function addComment(token: string, postId: string, content: string): Comment | null {
  const user = getSessionUser(token);
  if (!user) return null;
  const comment: Comment = { id: `c${comments.length+1}`, postId, content, authorId: user.id, createdAt: Date.now() };
  comments.push(comment);
  return comment;
}

export function getCommentsForPost(postId: string): Comment[] {
  return comments.filter(c => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteComment(token: string, commentId: string): boolean {
  const user = getSessionUser(token);
  if (!user) return false;
  const idx = comments.findIndex(c => c.id === commentId && c.authorId === user.id);
  if (idx < 0) return false;
  comments.splice(idx, 1);
  return true;
}
