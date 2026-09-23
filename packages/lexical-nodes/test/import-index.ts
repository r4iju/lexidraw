// Run by no-react.test.ts: loads the package entry and reports every module
// from a browser-only dependency that ended up in the module graph.
import "../src/index.js";
import { FORBIDDEN_MODULES, loadedForbiddenModules } from "./forbidden.js";

const loaded = loadedForbiddenModules();
if (loaded.length > 0) {
  console.error(`forbidden modules loaded:\n${loaded.join("\n")}`);
  process.exit(1);
}
console.log(`ok: none of ${FORBIDDEN_MODULES.join(", ")} loaded`);
