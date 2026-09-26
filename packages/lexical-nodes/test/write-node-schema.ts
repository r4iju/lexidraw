// Rewrites the committed node schema; `bun run node-schema` runs it.
import { fileURLToPath } from "node:url";
import { exportNodeSchema, NODE_SCHEMA_URL } from "../src/node-schema.js";
import { CORE_NODES } from "../src/nodes.js";

const path = fileURLToPath(NODE_SCHEMA_URL);
await Bun.write(path, JSON.stringify(exportNodeSchema(CORE_NODES), null, 2));
const format = Bun.spawnSync({
  cmd: ["bun", "x", "@biomejs/biome", "format", "--write", path],
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(format.exitCode);
