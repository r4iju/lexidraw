import { expect, test } from "bun:test";
import { NODE_SCHEMA_URL } from "@packages/lexical-nodes/node-schema";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";

test("the committed Swift payload types are a fresh codegen of the committed schema", async () => {
  // `bun run codegen` in apps/ios rewrites them.
  const schema = await Bun.file(NODE_SCHEMA_URL).json();
  const committed = await Bun.file(SERIALIZED_NODES_PATH).text();
  expect(committed).toBe(swiftForNodeSchema(schema));
});
