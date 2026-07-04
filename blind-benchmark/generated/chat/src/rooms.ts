// Real-time chat backend - rooms module
import { validateToken } from "./auth";

interface Room { id: string; name: string; createdBy: string; members: string[]; }
const rooms: Room[] = [];

let nextId = 1;

export function createRoom(token: string, name: string): Room | null {
  const user = validateToken(token);
  if (!user) return null;
  const room: Room = { id: `rm${nextId++}`, name, createdBy: user.id, members: [user.id] };
  rooms.push(room);
  return room;
}

export function joinRoom(token: string, roomId: string): Room | null {
  const user = validateToken(token);
  if (!user) return null;
  const room = rooms.find(r => r.id === roomId);
  if (!room) return null;
  if (!room.members.includes(user.id)) room.members.push(user.id);
  return room;
}

export function listRooms(): Room[] {
  return rooms;
}
