import { expect, test } from "bun:test";
import { NODE_SCHEMA_URL } from "@packages/lexical-nodes/node-schema";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";

test("names each node's Swift type and case after its Lexical class", () => {
  const swift = swiftForNodeSchema({
    nodes: [
      {
        type: "horizontalrule",
        className: "HorizontalRuleNode",
        version: 1,
        children: false,
        fields: {},
        state: {},
      },
    ],
    undeclared: [],
    traits: {},
  });

  expect(swift).toContain("case horizontalRule(SerializedHorizontalRuleNode)");
  expect(swift).toContain(
    'case "horizontalrule": self.init(json, as: Self.horizontalRule)',
  );
  expect(swift).toContain(
    "public struct SerializedHorizontalRuleNode: NodePayload {",
  );
});

test("the committed Swift payload types are a fresh codegen of the committed schema", async () => {
  const schema = await Bun.file(NODE_SCHEMA_URL).json();
  const committed = await Bun.file(SERIALIZED_NODES_PATH).text();
  expect(committed).toBe(swiftForNodeSchema(schema));
});
