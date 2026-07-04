// Discussion forum - replies module
import { getCurrentUser } from "./auth";

interface Reply { id: string; topicId: string; content: string; authorId: string; createdAt: number; }
const replies: Reply[] = [];

let nextId = 1;

export function createReply(token: string, topicId: string, content: string): Reply | null {
  const user = getCurrentUser(token);
  if (!user) return null;
  const reply: Reply = { id: `r${nextId++}`, topicId, content, authorId: user.id, createdAt: Date.now() };
  replies.push(reply);
  return reply;
}

export function listReplies(topicId: string): Reply[] {
  return replies.filter(r => r.topicId === topicId).sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteReply(token: string, replyId: string): boolean {
  const user = getCurrentUser(token);
  if (!user) return false;
  const idx = replies.findIndex(r => r.id === replyId && r.authorId === user.id);
  if (idx < 0) return false;
  replies.splice(idx, 1);
  return true;
}
