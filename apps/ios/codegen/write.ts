// Rewrites the Swift payload types from the committed node schema;
// `bun run codegen` runs it.
import { NODE_SCHEMA_URL } from "@packages/lexical-nodes/node-schema";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";

await Bun.write(
  SERIALIZED_NODES_PATH,
  swiftForNodeSchema(await Bun.file(NODE_SCHEMA_URL).json()),
);
