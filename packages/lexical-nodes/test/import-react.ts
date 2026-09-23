// Positive control for no-react.test.ts: this must be reported.
import "react";
import { loadedForbiddenModules } from "./forbidden.js";

const loaded = loadedForbiddenModules();
if (loaded.length > 0) {
  console.error(`forbidden modules loaded:\n${loaded.join("\n")}`);
  process.exit(1);
}
