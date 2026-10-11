import {
  finishFragment,
  fragmentAt,
} from "../../lexidraw/src/lib/generation/autocomplete-fragment";

import { prepareAutocomplete } from "../../lexidraw/src/lib/generation/autocomplete";

const LOCAL_BEFORE_CHARS = 1200;

// Exclude a whole scalar at a clipped boundary without scanning the document or widening its UTF16 budget.
function scalarWindow(text: string, start: number, end: number) {
  const high = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
  const low = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;
  if (
    start > 0 &&
    high(text.charCodeAt(start - 1)) &&
    low(text.charCodeAt(start))
  )
    start++;
  if (
    end < text.length &&
    high(text.charCodeAt(end - 1)) &&
    low(text.charCodeAt(end))
  )
    end--;
  return text.slice(start, end);
}
function localBefore(text: string) {
  return scalarWindow(
    text,
    Math.max(0, text.length - LOCAL_BEFORE_CHARS),
    text.length,
  );
}

/** Short, fresh-context continuations suit the built-in model's context and latency. */
export function prepareLocalContinuation(job: {
  title: string;
  before: string;
  after: string;
}) {
  const prepared = prepareAutocomplete({
    title: scalarWindow(job.title, 0, Math.min(200, job.title.length)),
    before: localBefore(job.before),
    after: scalarWindow(job.after, 0, Math.min(300, job.after.length)),
    config: {
      provider: "apple",
      modelId: "system",
      temperature: 0,
      maxOutputTokens: 32,
    },
  });
  return {
    system: prepared.system,
    prompt: prepared.prompt,
    maximumResponseTokens: prepared.config.maxOutputTokens,
  };
}

export function finishLocalContinuation(before: string, output: string) {
  return finishFragment(fragmentAt(localBefore(before)), output);
}
