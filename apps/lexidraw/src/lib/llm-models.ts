/**
 * Centralized model IDs used across the app to avoid scattered string literals.
 *
 * Note: this file is imported by both server and client code, so it MUST NOT
 * access process.env or include `server-only`.
 */

// --- Google (Gemini 3 family) defaults ---
// Per `GET https://generativelanguage.googleapis.com/v1beta/models`, this key currently
// exposes `models/gemini-3-pro-preview` but not Gemini 3 Flash.
export const DEFAULT_GOOGLE_CHAT_MODEL_ID = "gemini-3-pro-preview";
export const DEFAULT_GOOGLE_AGENT_MODEL_ID = "gemini-3-pro-preview";
// There is no Gemini 3 Flash-Lite in the model list for this key, so keep autocomplete
// on an available Flash-Lite.
export const DEFAULT_GOOGLE_AUTOCOMPLETE_MODEL_ID = "gemini-2.5-flash-lite";

// --- OpenAI (GPT-5 family) defaults ---
// Note: Your OpenAI account rejected `gpt-5.2-*` model IDs. These defaults use the
// older GPT-5 naming that existed in this codebase previously.
export const DEFAULT_OPENAI_CHAT_MODEL_ID = "gpt-5.2";
export const DEFAULT_OPENAI_AGENT_MODEL_ID = "gpt-5.2";
export const DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID = "gpt-5-nano";

// --- Planner (tool selection) ---
// We intentionally pin planner to small, fast models rather than the user's main chat model.
export const PLANNER_OPENAI_MODEL_ID = "gpt-5-nano";
export const PLANNER_GOOGLE_MODEL_ID = "gemini-2.5-flash";

/** 
  // llm
  [
    { "provider": "openai", "modelId": "gpt-5.2" },
    { "provider": "openai", "modelId": "gpt-5.2-pro" },
    { "provider": "openai", "modelId": "gpt-5-mini" },
    { "provider": "google", "modelId": "gemini-3-pro-preview" }
    { "provider": "google", "modelId": "gemini-2.5-flash" }
  ]
  // image
  [
    { "provider": "google", "modelId": "gemini-3-pro-image-preview" }
  ]
*/
