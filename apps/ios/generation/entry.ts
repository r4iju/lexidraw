import {
  imageRequest,
  validatePng,
} from "../../lexidraw/src/lib/images/format";
import { prepareLocalContinuation, finishLocalContinuation } from "./local";
import { prepareAutocomplete } from "../../lexidraw/src/lib/generation/autocomplete";
import {
  fragmentAt,
  finishFragment,
} from "../../lexidraw/src/lib/generation/autocomplete-fragment";

// No network, credentials, file system, console or timers enter this runtime.
Object.assign(globalThis, {
  nativeImageRequest(prompt: string) {
    return JSON.stringify(imageRequest(prompt));
  },
  nativeImageResult(base64: string) {
    validatePng(base64);
    return JSON.stringify({
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      base64,
    });
  },
  nativeAutocompleteRequest(title: string, before: string, after: string) {
    return JSON.stringify(
      prepareAutocomplete({
        title,
        before,
        after,
        config: {
          provider: "openrouter",
          modelId: "openai/gpt-4.1-mini",
          temperature: 0,
          maxOutputTokens: 64,
        },
      }),
    );
  },
  nativeLocalAutocompleteRequest(title: string, before: string, after: string) {
    return JSON.stringify(prepareLocalContinuation({ title, before, after }));
  },
  nativeLocalAutocompleteResult(before: string, output: string) {
    return finishLocalContinuation(before, output);
  },
  nativeAutocompleteResult(before: string, output: string) {
    return finishFragment(fragmentAt(before), output);
  },
});
