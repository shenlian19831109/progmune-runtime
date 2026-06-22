/**
 * Server utilities — HTTP helpers available to Progmune code generation.
 */

import { Request, Response, NextFunction } from "express";

/** Content validation: text posts only, max 500 chars. */
export function validatePostContent(content: unknown): { valid: true; content: string } | { valid: false; error: string } {
  if (typeof content !== "string") {
    return { valid: false, error: "Content must be a string" };
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Content cannot be empty" };
  }
  if (trimmed.length > 500) {
    return { valid: false, error: "Content too long (max 500 characters)" };
  }
  return { valid: true, content: trimmed };
}

/** Username validation */
export function validateUsername(name: unknown): { valid: true; username: string } | { valid: false; error: string } {
  if (typeof name !== "string") {
    return { valid: false, error: "Username must be a string" };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 30) {
    return { valid: false, error: "Username must be 1-30 characters" };
  }
  return { valid: true, username: trimmed };
}

/** Generic JSON success response */
export function sendJSON(res: Response, data: unknown, status: number = 200): void {
  res.status(status).json(data);
}

/** Generic JSON error response */
export function sendError(res: Response, message: string, status: number = 400): void {
  res.status(status).json({ error: message });
}

/** Parse request body as JSON (Express middleware already does this, but this is a safe wrapper) */
export function parseBody(req: Request): unknown {
  return req.body;
}

/** Get query parameter */
export function getQueryParam(req: Request, key: string): string | undefined {
  return req.query[key] as string | undefined;
}

/** Rate limiting — simple in-memory counter */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number = 20, windowMs: number = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = requestCounts.get(key);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}
