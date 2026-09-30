// The script `swiftForLinks` bundles for LexicalSwift to run.
import "../reference/url.js";
import {
  AUTOLINK_MATCHERS,
  sanitizeUrl,
  validateUrl,
} from "@packages/lexical-nodes/links";

Object.assign(globalThis, {
  linkConfiguration: {
    firstMatch(text: string) {
      for (const matcher of AUTOLINK_MATCHERS) {
        const match = matcher(text);
        if (match) return match;
      }
      return null;
    },
    validateUrl,
    sanitizeUrl,
  },
});
