// Real-time chat backend - server entry point
import { createUser, authenticate, invalidateSession } from "./auth";
import { createRoom, joinRoom, listRooms } from "./rooms";
import { sendMessage, getMessages } from "./messages";
import { uploadFile, downloadFile } from "./files";

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  if (path === "/register" && method === "POST") return { data: createUser(body.username, body.password) };
  if (path === "/login" && method === "POST") {
    const s = authenticate(body.username, body.password);
    return s ? { data: { token: s.token } } : { error: "Auth failed", status: 401 };
  }
  if (path === "/logout" && method === "POST") { invalidateSession(token!); return { data: true }; }

  if (path === "/rooms" && method === "POST") return { data: createRoom(token!, body.name) };
  if (path === "/rooms" && method === "GET") return { data: listRooms() };
  if (path.startsWith("/rooms/") && path.endsWith("/join") && method === "POST") return { data: joinRoom(token!, path.split("/")[2]) };

  if (path === "/messages" && method === "POST") return { data: sendMessage(token!, body.roomId, body.content) };
  if (path === "/messages" && method === "GET") return { data: getMessages(body.roomId) };

  if (path === "/files/upload" && method === "POST") return { data: uploadFile(token!, body.roomId, body.fileName, Buffer.from(body.data || "")) };
  if (path.startsWith("/files/") && method === "GET") return { data: downloadFile(path.split("/")[2]) };

  return { error: "Not found", status: 404 };
}
