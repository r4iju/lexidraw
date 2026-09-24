import "server-only";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

/** Enough text around the cursor for tone and topic, small enough to stay fast. */
export const MAX_BEFORE_CHARS = 3000;
export const MAX_AFTER_CHARS = 600;

/** A suggestion is at most a sentence; more tokens only add latency. */
export const MAX_SUGGESTION_TOKENS = 64;

export const AUTOCOMPLETE_SYSTEM = [
  "You are the inline autocomplete in a document editor. The user is typing at <cursor/>.",
  "Reply with only the text to insert at <cursor/>: no quotes, labels, markdown, or explanations.",
  "Continue naturally from the last character before <cursor/>. If it ends mid-word, finish that word first. If the continuation starts a new word and there is no space before <cursor/>, begin with a space.",
  "Keep it short: finish the current sentence or list item, at most about 12 words. Never start a new paragraph.",
  "Write in the same language, tone and format as the document. Do not repeat text that already appears after <cursor/>.",
  "If there is no confident continuation, reply with nothing.",
].join("\n");

export function autocompletePrompt({
  title,
  before,
  after,
}: {
  title: string;
  before: string;
  after: string;
}): string {
  const heading = title ? `Document title: ${title}\n\n` : "";
  return `${heading}${before.slice(-MAX_BEFORE_CHARS)}<cursor/>${after.slice(0, MAX_AFTER_CHARS)}`;
}

/**
 * Provider options that turn reasoning as far down as the model allows: a
 * suggestion that thinks first arrives after the user has moved on.
 */
export function lowestReasoning(
  provider: string,
  modelId: string,
): ProviderOptions | undefined {
  if (provider === "openai") {
    // GPT-5 accepts "minimal" at the lowest; GPT-5.1 and later accept "none".
    if (/^gpt-5(-|$)/.test(modelId)) {
      return { openai: { reasoningEffort: "minimal", textVerbosity: "low" } };
    }
    if (/^gpt-5\.\d/.test(modelId)) {
      return { openai: { reasoningEffort: "none", textVerbosity: "low" } };
    }
    if (/^o\d/.test(modelId)) return { openai: { reasoningEffort: "low" } };
    return undefined;
  }
  if (provider === "google") {
    if (/^gemini-2\.5-flash/.test(modelId)) {
      return { google: { thinkingConfig: { thinkingBudget: 0 } } };
    }
    if (/^gemini-\d/.test(modelId) && !/^gemini-[12]\./.test(modelId)) {
      return { google: { thinkingConfig: { thinkingLevel: "minimal" } } };
    }
  }
  return undefined;
}
