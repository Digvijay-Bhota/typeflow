/**
 * General utility functions.
 *
 * Pure functions, no side effects, safe to use anywhere.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names with conflict resolution.
 * Combines clsx (conditional class logic) with tailwind-merge
 * (deduplication/conflict resolution).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a duration in seconds to a human-readable string.
 * e.g. 300 → "5 minutes", 60 → "1 minute", 30 → "30 seconds"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

/**
 * Format milliseconds to MM:SS display.
 * e.g. 90000ms → "1:30"
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format a number with consistent decimal places.
 * Used for WPM, accuracy display.
 */
export function formatNumber(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

/**
 * Format accuracy as a percentage string.
 * e.g. 0.964 → "96.4%"
 */
export function formatAccuracy(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate a cryptographically random string of specified length.
 * Uses Web Crypto API (browser/Node 19+).
 */
export function generateId(length = 21): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Generate a TypeFlow certificate ID.
 * Format: TF-YYYY-XXXXXX (where X is uppercase alphanumeric)
 */
export function generateCertificateId(): string {
  const year = new Date().getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `TF-${year}-${suffix}`;
}

/**
 * Sleep for a given number of milliseconds.
 * Useful in tests and retry logic.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce a function — returns a function that delays invoking fn
 * until after waitMs milliseconds have elapsed since the last call.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

/**
 * Truncate a string to maxLength, adding ellipsis if needed.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/**
 * Check if code is running in browser context.
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Hash a string to a consistent number (for deterministic selection).
 * Uses djb2 algorithm — not cryptographically secure, only for indexing.
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) + hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}
