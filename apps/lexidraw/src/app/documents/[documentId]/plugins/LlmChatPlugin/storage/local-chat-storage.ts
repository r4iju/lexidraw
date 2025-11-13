"use client";

import type { ChatState } from "../llm-chat-context";

const STORAGE_PREFIX = "ld:chat:v1:";
const INDEX_KEY = `${STORAGE_PREFIX}index`;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

type StorageIndex = {
  [key: string]: {
    updatedAt: number;
    size: number;
  };
};

type ChatMode = ChatState["mode"];

/**
 * Builds a storage key for messages or input text
 */
export function buildKey(
  documentId: string,
  mode: ChatMode,
  type: "messages" | "input",
): string {
  return `${STORAGE_PREFIX}${documentId}:${mode}:${type}`;
}

/**
 * Calculates the byte size of a JSON string
 */
function getByteSize(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Loads the storage index from localStorage
 */
function loadIndex(): StorageIndex {
  if (typeof window === "undefined") return {};
  try {
    const indexStr = localStorage.getItem(INDEX_KEY);
    if (!indexStr) return {};
    return JSON.parse(indexStr) as StorageIndex;
  } catch {
    return {};
  }
}

/**
 * Updates the storage index with a new entry
 */
function updateIndex(key: string, size: number): void {
  if (typeof window === "undefined") return;
  const index = loadIndex();
  index[key] = {
    updatedAt: Date.now(),
    size,
  };
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.error("Failed to update storage index:", error);
  }
}

/**
 * Calculates total bytes used by our namespace
 */
function getTotalBytes(): number {
  const index = loadIndex();
  return Object.values(index).reduce((sum, entry) => sum + entry.size, 0);
}

/**
 * Purges oldest entries until total bytes is under MAX_BYTES
 */
function purgeIfNeeded(): void {
  if (typeof window === "undefined") return;
  const index = loadIndex();
  let totalBytes = getTotalBytes();

  if (totalBytes <= MAX_BYTES) return;

  // Sort entries by updatedAt (oldest first)
  const entries = Object.entries(index)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.updatedAt - b.updatedAt);

  // Remove oldest entries until under limit
  while (totalBytes > MAX_BYTES && entries.length > 0) {
    const oldest = entries.shift();
    if (!oldest) break;
    try {
      localStorage.removeItem(oldest.key);
      delete index[oldest.key];
      totalBytes -= oldest.size;
    } catch (error) {
      console.error(`Failed to remove key ${oldest.key}:`, error);
    }
  }

  // Update index
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.error("Failed to save index after purge:", error);
  }
}

/**
 * Loads messages from localStorage for a given documentId and mode
 */
export function loadMessages(
  documentId: string,
  mode: ChatMode,
): ChatState["messages"] {
  if (typeof window === "undefined") return [];
  const key = buildKey(documentId, mode, "messages");
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as ChatState["messages"];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to load messages for ${key}:`, error);
    return [];
  }
}

/**
 * Saves messages to localStorage for a given documentId and mode
 */
export function saveMessages(
  documentId: string,
  mode: ChatMode,
  messages: ChatState["messages"],
): void {
  if (typeof window === "undefined") return;
  const key = buildKey(documentId, mode, "messages");
  try {
    const json = JSON.stringify(messages);
    const size = getByteSize(json);
    localStorage.setItem(key, json);
    updateIndex(key, size);
    purgeIfNeeded();
  } catch (error) {
    console.error(`Failed to save messages for ${key}:`, error);
    // If quota exceeded, try purging and retry once
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      purgeIfNeeded();
      try {
        const json = JSON.stringify(messages);
        const size = getByteSize(json);
        localStorage.setItem(key, json);
        updateIndex(key, size);
      } catch (retryError) {
        console.error(
          `Failed to save messages after purge for ${key}:`,
          retryError,
        );
      }
    }
  }
}

/**
 * Loads input text from localStorage for a given documentId and mode
 */
export function loadInput(documentId: string, mode: ChatMode): string {
  if (typeof window === "undefined") return "";
  const key = buildKey(documentId, mode, "input");
  try {
    const stored = localStorage.getItem(key);
    return stored ?? "";
  } catch (error) {
    console.error(`Failed to load input for ${key}:`, error);
    return "";
  }
}

/**
 * Clears storage (messages and input) for a given documentId and mode
 */
export function clearStorage(documentId: string, mode: ChatMode): void {
  if (typeof window === "undefined") return;
  const messagesKey = buildKey(documentId, mode, "messages");
  const inputKey = buildKey(documentId, mode, "input");

  try {
    localStorage.removeItem(messagesKey);
    localStorage.removeItem(inputKey);

    // Remove from index
    const index = loadIndex();
    delete index[messagesKey];
    delete index[inputKey];
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.error(`Failed to clear storage for ${documentId}:${mode}:`, error);
  }
}

/**
 * Saves input text to localStorage for a given documentId and mode
 */
export function saveInput(
  documentId: string,
  mode: ChatMode,
  input: string,
): void {
  if (typeof window === "undefined") return;
  const key = buildKey(documentId, mode, "input");
  try {
    const size = getByteSize(input);
    localStorage.setItem(key, input);
    updateIndex(key, size);
    purgeIfNeeded();
  } catch (error) {
    console.error(`Failed to save input for ${key}:`, error);
    // If quota exceeded, try purging and retry once
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      purgeIfNeeded();
      try {
        const size = getByteSize(input);
        localStorage.setItem(key, input);
        updateIndex(key, size);
      } catch (retryError) {
        console.error(
          `Failed to save input after purge for ${key}:`,
          retryError,
        );
      }
    }
  }
}
