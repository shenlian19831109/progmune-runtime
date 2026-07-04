// Real-time chat backend - files module
import { validateToken } from "./auth";
import * as fs from "fs";
import * as path from "path";

interface FileInfo { id: string; name: string; roomId: string; userId: string; size: number; path: string; }
const files: FileInfo[] = [];
const UPLOAD_DIR = "/tmp/chat-uploads";

let nextId = 1;

export function uploadFile(token: string, roomId: string, fileName: string, data: Buffer): FileInfo | null {
  const user = validateToken(token);
  if (!user) return null;
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, `${nextId}_${fileName}`);
  fs.writeFileSync(filePath, data);
  const info: FileInfo = { id: `f${nextId++}`, name: fileName, roomId, userId: user.id, size: data.length, path: filePath };
  files.push(info);
  return info;
}

export function downloadFile(fileId: string): Buffer | null {
  const info = files.find(f => f.id === fileId);
  if (!info || !fs.existsSync(info.path)) return null;
  return fs.readFileSync(info.path);
}
