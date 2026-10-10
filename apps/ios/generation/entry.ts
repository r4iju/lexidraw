import {
  narrationTexts,
  speechRequest,
  audioFromPCM,
  validateWav,
} from "../../lexidraw/src/lib/narration/portable";
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

Object.assign(globalThis, {
  nativeNarrationPlan(text: string) {
    return JSON.stringify(narrationTexts(text));
  },
  nativeNarrationRequest(text: string) {
    return JSON.stringify(speechRequest(text));
  },
  nativeNarrationPCM(base64: string) {
    const binary = atob(base64),
      bytes = Uint8Array.from(binary, (x) => x.charCodeAt(0));
    return JSON.stringify(audioFromPCM(bytes, () => {}));
  },
  nativeNarrationResult(base64: string) {
    return JSON.stringify({
      audio: base64,
      seconds: validateWav(base64).seconds,
    });
  },
});
