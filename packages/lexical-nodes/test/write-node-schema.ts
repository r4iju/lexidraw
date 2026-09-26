import { fileURLToPath } from "node:url";
import {
  exportNodeSchema,
  NODE_SCHEMA_URL,
  nodeSchemaFile,
} from "../src/node-schema.js";
import { SCHEMA_NODES } from "../src/nodes.js";

await Bun.write(
  fileURLToPath(NODE_SCHEMA_URL),
  nodeSchemaFile(exportNodeSchema(SCHEMA_NODES)),
);
