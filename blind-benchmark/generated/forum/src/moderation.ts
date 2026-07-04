// Discussion forum - moderation module
import { isModerator } from "./auth";

interface ModLog { id: string; action: string; targetType: string; targetId: string; moderatorId: string; timestamp: number; }
const modLogs: ModLog[] = [];

let nextId = 1;

export function deleteTopicMod(token: string, topicId: string): boolean {
  return isModerator(token);
}

export function deleteReplyMod(token: string, replyId: string): boolean {
  return isModerator(token);
}

export function banUser(token: string, userId: string): boolean {
  if (!isModerator(token)) return false;
  const log: ModLog = { id: `ml${nextId++}`, action: "ban", targetType: "user", targetId: userId, moderatorId: "mod", timestamp: Date.now() };
  modLogs.push(log);
  return true;
}

export function getModLogs(): ModLog[] {
  return modLogs;
}
