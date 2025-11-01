import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names
 * @param inputs - Class names to merge. Later arguments take precedence over the previous ones.
 * @returns Merged class names
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a UUID using crypto.randomUUID() if available, otherwise falls back to a Math.random-based approach.
 * This ensures compatibility across different environments (browser, SSR, Node.js).
 * @returns A UUID string
 */
export function generateUUID(): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    "randomUUID" in globalThis.crypto
  ) {
    return (
      globalThis.crypto as unknown as { randomUUID: () => string }
    ).randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
