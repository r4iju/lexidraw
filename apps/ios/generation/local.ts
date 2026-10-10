import {
  finishFragment,
  fragmentAt,
} from "../../lexidraw/src/lib/generation/autocomplete-fragment";

import { prepareAutocomplete } from "../../lexidraw/src/lib/generation/autocomplete";

const LOCAL_BEFORE_CHARS = 1200;

/** Short, fresh-context continuations suit the built-in model's context and latency. */
export function prepareLocalContinuation(job: {
  title: string;
  before: string;
  after: string;
}) {
  const prepared = prepareAutocomplete({
    title: job.title.slice(0, 200),
    before: job.before.slice(-LOCAL_BEFORE_CHARS),
    after: job.after.slice(0, 300),
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
  return finishFragment(fragmentAt(before.slice(-LOCAL_BEFORE_CHARS)), output);
}
