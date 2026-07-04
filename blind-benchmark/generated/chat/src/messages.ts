// Real-time chat backend - messages module
import { validateToken } from "./auth";

interface Message { id: string; roomId: string; userId: string; content: string; timestamp: number; }
const messages: Message[] = [];

let nextId = 1;

export function sendMessage(token: string, roomId: string, content: string): Message | null {
  const user = validateToken(token);
  if (!user) return null;
  const msg: Message = { id: `msg${nextId++}`, roomId, userId: user.id, content, timestamp: Date.now() };
  messages.push(msg);
  return msg;
}

export function getMessages(roomId: string): Message[] {
  return messages.filter(m => m.roomId === roomId).sort((a, b) => a.timestamp - b.timestamp);
}
