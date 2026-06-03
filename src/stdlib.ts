/**
 * Progmune Standard Library — general-purpose utilities for external tasks.
 * Each function has @requires/@produces for Capability Graph integration.
 */

// ── String ──

/** @requires STRING @produces VALIDATION_RESULT @tags string, email, validation */
export function isValidEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/** @requires STRING @produces TRUNCATED_STRING @tags string, format */
export function truncate(str: string, maxLen: number, ellipsis = "..."): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - ellipsis.length) + ellipsis;
}

/** @requires STRING @produces FORMATTED_STRING @tags string, case, format */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c: string) => "_" + c.toLowerCase());
}

/** @requires STRING @produces FORMATTED_STRING @tags string, case, format */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/** @requires STRING @produces COUNT @tags string, count */
export function countSubstring(str: string, sub: string): number {
  if (!sub) return 0;
  let count = 0, pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos += sub.length; }
  return count;
}

/** @requires STRING @produces CLEANED_STRING @tags string, format */
export function removeWhitespace(str: string): string {
  return str.replace(/\s+/g, "");
}

// ── Array ──

/** @requires ARRAY @produces ELEMENT @tags array, statistics */
export function mostFrequent<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const counts = new Map<T, number>();
  for (const item of arr) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** @requires ARRAY @produces ARRAY @tags array, dedupe */
export function unique<T>(arr: T[]): T[] { return [...new Set(arr)]; }

/** @requires ARRAY @produces ARRAY @tags array, chunk */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/** @requires ARRAY @produces ARRAY @tags array, difference */
export function arrayDiff<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter(x => !setB.has(x));
}

// ── Math ──

/** @requires NUMBERS @produces AVERAGE @tags math, statistics */
export function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** @requires NUMBERS @produces MEDIAN @tags math, statistics */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** @requires NUMBER @produces ROUNDED_NUMBER @tags math, format */
export function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/** @requires NUMBER @produces PRIME_CHECK @tags math, validation */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;
  return true;
}

/** @requires NUMBERS @produces RANDOM_INT @tags math, random */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Object ──

/** @requires OBJECT @produces CLONED_OBJECT @tags object, clone */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** @requires OBJECT @produces PICKED_OBJECT @tags object, filter */
export function pick<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const result: any = {};
  for (const k of keys) if (k in obj) result[k] = obj[k];
  return result;
}

/** @requires OBJECTS @produces MERGED_OBJECT @tags object, merge */
export function deepMerge(...objects: any[]): any {
  return objects.reduce((acc, obj) => {
    for (const key of Object.keys(obj || {})) {
      acc[key] = typeof obj[key] === "object" && !Array.isArray(obj[key])
        ? deepMerge(acc[key] || {}, obj[key]) : obj[key];
    }
    return acc;
  }, {});
}

// ── Validation ──

/** @requires OBJECT @produces VALIDATION_RESULT @tags validation, schema */
export function hasRequiredFields(obj: any, fields: string[]): boolean {
  return fields.every(f => obj && obj[f] !== undefined && obj[f] !== null);
}

/** @requires ANY @produces VALIDATION_RESULT @tags validation, type */
export function isPlainObject(val: any): boolean {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/** @requires STRING @produces PARSED_VERSION @tags validation, semver */
export function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

// ── Formatting ──

/** @requires NUMBER @produces FORMATTED_STRING @tags format, duration */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** @requires NUMBER @produces FORMATTED_STRING @tags format, file */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/** @requires OBJECT @produces QUERY_STRING @tags web, format */
export function toQueryString(obj: Record<string, any>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ── Async ──

/** @requires FUNCTION @produces RETRY_RESULT @tags async, retry */
export async function retry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) { if (i === maxRetries - 1) throw e; }
  }
  throw new Error("unreachable");
}

/** @requires FUNCTION @produces DEBOUNCED_FUNCTION @tags async, debounce */
export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: any;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as any;
}
