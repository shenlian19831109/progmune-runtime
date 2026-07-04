/**
 * File module — AI-generated file operations.
 *
 * Protocol: File Lifecycle (Progmune WARN-ready, 74% coverage)
 *
 * Correct protocol order:
 *   open_file → read_file / write_file → close_file
 *
 * @protocol file
 *   pre_states=[] post_states=["FILE_OPEN"]
 * @protocol file
 *   pre_states=["FILE_OPEN"] post_states=[]
 * @protocol file
 *   pre_states=["FILE_OPEN"] post_states=[]
 * @protocol file
 *   pre_states=["FILE_OPEN"] post_states=[] invalidate=["FILE_OPEN"]
 */

import * as fs from "fs";
import * as path from "path";

const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Protocol Step 1: open_file ──

/**
 * Open a file and return its descriptor.
 * @protocol file pre_states=[] post_states=["FILE_OPEN"]
 */
export function open_file(filePath: string): number {
  const fd = fs.openSync(filePath, "r");
  return fd;
}

// ── Protocol Step 2a: read_file ──

/**
 * Read file contents.
 * @protocol file pre_states=["FILE_OPEN"] post_states=[]
 */
export function read_file(fd: number, buffer: Buffer, offset: number, length: number, position: number): number {
  return fs.readSync(fd, buffer, offset, length, position);
}

// ── Protocol Step 2b: write_file ──

/**
 * Write data to a file.
 * @protocol file pre_states=["FILE_OPEN"] post_states=[]
 */
export function write_file(filename: string, data: string): void {
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, data);
}

// ── Protocol Step 3: close_file ──

/**
 * Close a file descriptor and release the resource.
 * @protocol file pre_states=["FILE_OPEN"] post_states=[] invalidate=["FILE_OPEN"]
 */
export function close_file(fd: number): void {
  fs.closeSync(fd);
}

// ── AI-GENERATED BUG (intentional — Progmune should catch this) ──

/**
 * BUG: Read file without closing it.
 * Progmune verdict: WARN/BLOCK (resource leak — FILE_OPEN not released)
 */
export function readFileWithoutClose(filename: string): string {
  const fp = open_file(path.join(UPLOAD_DIR, filename));
  const buffer = Buffer.alloc(1024);
  read_file(fp, buffer, 0, 1024, 0);
  // BUG: close_file() never called — resource leak!
  // Progmune detects: FILE_OPEN still held after function returns
  return buffer.toString("utf-8");
}

// ── Correct usage ──

export function safeReadFile(filename: string): string {
  const filePath = path.join(UPLOAD_DIR, filename);

  // Ensure file exists
  if (!fs.existsSync(filePath)) {
    write_file(filename, "");
  }

  const fp = open_file(filePath);
  const buffer = Buffer.alloc(1024);
  const bytesRead = read_file(fp, buffer, 0, 1024, 0);
  close_file(fp); // ✅ Proper cleanup

  return buffer.toString("utf-8", 0, bytesRead);
}
