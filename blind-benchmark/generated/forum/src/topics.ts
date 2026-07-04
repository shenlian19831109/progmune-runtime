// Discussion forum - topics module
import { getCurrentUser } from "./auth";

interface Topic { id: string; categoryId: string; title: string; content: string; authorId: string; createdAt: number; locked: boolean; }
const topics: Topic[] = [];

let nextId = 1;

export function createTopic(token: string, categoryId: string, title: string, content: string): Topic | null {
  const user = getCurrentUser(token);
  if (!user) return null;
  const topic: Topic = { id: `t${nextId++}`, categoryId, title, content, authorId: user.id, createdAt: Date.now(), locked: false };
  topics.push(topic);
  return topic;
}

export function listTopics(categoryId?: string): Topic[] {
  const filtered = categoryId ? topics.filter(t => t.categoryId === categoryId) : topics;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export function getTopic(topicId: string): Topic | null {
  return topics.find(t => t.id === topicId) || null;
}

export function lockTopic(topicId: string): Topic | null {
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return null;
  topic.locked = true;
  return topic;
}
