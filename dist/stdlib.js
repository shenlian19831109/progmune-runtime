"use strict";
/**
 * Progmune Standard Library — general-purpose utilities for external tasks.
 * Each function has @requires/@produces for Capability Graph integration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidEmail = isValidEmail;
exports.truncate = truncate;
exports.camelToSnake = camelToSnake;
exports.capitalizeWords = capitalizeWords;
exports.countSubstring = countSubstring;
exports.removeWhitespace = removeWhitespace;
exports.mostFrequent = mostFrequent;
exports.unique = unique;
exports.chunk = chunk;
exports.arrayDiff = arrayDiff;
exports.average = average;
exports.median = median;
exports.roundTo = roundTo;
exports.isPrime = isPrime;
exports.randomInt = randomInt;
exports.deepClone = deepClone;
exports.pick = pick;
exports.deepMerge = deepMerge;
exports.hasRequiredFields = hasRequiredFields;
exports.isPlainObject = isPlainObject;
exports.parseSemver = parseSemver;
exports.formatDuration = formatDuration;
exports.formatFileSize = formatFileSize;
exports.toQueryString = toQueryString;
exports.retry = retry;
exports.debounce = debounce;
// ── String ──
/** @requires STRING @produces VALIDATION_RESULT @tags string, email, validation */
function isValidEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}
/** @requires STRING @produces TRUNCATED_STRING @tags string, format */
function truncate(str, maxLen, ellipsis = "...") {
    return str.length <= maxLen ? str : str.slice(0, maxLen - ellipsis.length) + ellipsis;
}
/** @requires STRING @produces FORMATTED_STRING @tags string, case, format */
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
/** @requires STRING @produces FORMATTED_STRING @tags string, case, format */
function capitalizeWords(str) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
/** @requires STRING @produces COUNT @tags string, count */
function countSubstring(str, sub) {
    if (!sub)
        return 0;
    let count = 0, pos = 0;
    while ((pos = str.indexOf(sub, pos)) !== -1) {
        count++;
        pos += sub.length;
    }
    return count;
}
/** @requires STRING @produces CLEANED_STRING @tags string, format */
function removeWhitespace(str) {
    return str.replace(/\s+/g, "");
}
// ── Array ──
/** @requires ARRAY @produces ELEMENT @tags array, statistics */
function mostFrequent(arr) {
    if (arr.length === 0)
        return null;
    const counts = new Map();
    for (const item of arr)
        counts.set(item, (counts.get(item) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
/** @requires ARRAY @produces ARRAY @tags array, dedupe */
function unique(arr) { return [...new Set(arr)]; }
/** @requires ARRAY @produces ARRAY @tags array, chunk */
function chunk(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size)
        result.push(arr.slice(i, i + size));
    return result;
}
/** @requires ARRAY @produces ARRAY @tags array, difference */
function arrayDiff(a, b) {
    const setB = new Set(b);
    return a.filter(x => !setB.has(x));
}
// ── Math ──
/** @requires NUMBERS @produces AVERAGE @tags math, statistics */
function average(nums) {
    return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}
/** @requires NUMBERS @produces MEDIAN @tags math, statistics */
function median(nums) {
    if (nums.length === 0)
        return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** @requires NUMBER @produces ROUNDED_NUMBER @tags math, format */
function roundTo(num, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}
/** @requires NUMBER @produces PRIME_CHECK @tags math, validation */
function isPrime(n) {
    if (n < 2)
        return false;
    for (let i = 2; i <= Math.sqrt(n); i++)
        if (n % i === 0)
            return false;
    return true;
}
/** @requires NUMBERS @produces RANDOM_INT @tags math, random */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
// ── Object ──
/** @requires OBJECT @produces CLONED_OBJECT @tags object, clone */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
/** @requires OBJECT @produces PICKED_OBJECT @tags object, filter */
function pick(obj, keys) {
    const result = {};
    for (const k of keys)
        if (k in obj)
            result[k] = obj[k];
    return result;
}
/** @requires OBJECTS @produces MERGED_OBJECT @tags object, merge */
function deepMerge(...objects) {
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
function hasRequiredFields(obj, fields) {
    return fields.every(f => obj && obj[f] !== undefined && obj[f] !== null);
}
/** @requires ANY @produces VALIDATION_RESULT @tags validation, type */
function isPlainObject(val) {
    return val !== null && typeof val === "object" && !Array.isArray(val);
}
/** @requires STRING @produces PARSED_VERSION @tags validation, semver */
function parseSemver(version) {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match)
        return null;
    return { major: +match[1], minor: +match[2], patch: +match[3] };
}
// ── Formatting ──
/** @requires NUMBER @produces FORMATTED_STRING @tags format, duration */
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
}
/** @requires NUMBER @produces FORMATTED_STRING @tags format, file */
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1048576)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
}
/** @requires OBJECT @produces QUERY_STRING @tags web, format */
function toQueryString(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
}
// ── Async ──
/** @requires FUNCTION @produces RETRY_RESULT @tags async, retry */
async function retry(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            if (i === maxRetries - 1)
                throw e;
        }
    }
    throw new Error("unreachable");
}
/** @requires FUNCTION @produces DEBOUNCED_FUNCTION @tags async, debounce */
function debounce(fn, delay) {
    let timer;
    return ((...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    });
}
