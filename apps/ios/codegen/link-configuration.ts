// The script `swiftForLinks` bundles for LexicalSwift to run.
import { AUTOLINK_MATCHERS, validateUrl } from "@packages/lexical-nodes/links";

Object.assign(globalThis, {
  linkConfiguration: { matchers: AUTOLINK_MATCHERS, validateUrl },
});
