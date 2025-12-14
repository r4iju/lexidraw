import "server-only";

import type { StoredLlmConfig } from "~/server/api/routers/config";
import {
  DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_OPENAI_CHAT_MODEL_ID,
} from "~/lib/llm-models";

/**
 * Initial LLM config used for pages that render without a user session (e.g. print/screenshot).
 *
 * This is primarily UI initialization; server-side enforcement still happens through
 * `LLMPolicies` via `getEffectiveLlmConfig` on actual requests.
 */
export const INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER: StoredLlmConfig = {
  chat: {
    provider: "openai",
    modelId: DEFAULT_OPENAI_CHAT_MODEL_ID,
    temperature: 0.7,
    maxOutputTokens: 100000,
  },
  autocomplete: {
    provider: "openai",
    modelId: DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
    temperature: 0.3,
    maxOutputTokens: 500,
  },
  agent: {
    provider: "openai",
    modelId: DEFAULT_OPENAI_CHAT_MODEL_ID,
    temperature: 0.7,
    maxOutputTokens: 100000,
  },
};
