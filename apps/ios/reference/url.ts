/// <reference path="./whatwg-url.d.ts" />
/**
 * `URL`, which JavaScriptCore lacks, for the link editor's `sanitizeUrl`:
 * whatwg-url is the URL Standard's own implementation. It needs the
 * `TextEncoder` and `TextDecoder` that the Swift side defines.
 */
import { URL } from "whatwg-url";

if (typeof globalThis.URL === "undefined") Object.assign(globalThis, { URL });
