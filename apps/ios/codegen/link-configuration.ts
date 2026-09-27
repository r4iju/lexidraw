// The script `swiftForLinks` bundles for LexicalSwift to run.
import "../reference/url.js";
import {
  AUTOLINK_MATCHERS,
  sanitizeUrl,
  validateUrl,
} from "@packages/lexical-nodes/links";

Object.assign(globalThis, {
  linkConfiguration: { matchers: AUTOLINK_MATCHERS, validateUrl, sanitizeUrl },
});
