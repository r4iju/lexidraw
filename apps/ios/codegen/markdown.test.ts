import { expect, test } from "bun:test";
import { HEADING, type Transformer } from "@lexical/markdown";
import { createTransformers } from "@packages/lexical-nodes/transformers";
import {
  MARKDOWN_TRANSFORMERS_PATH,
  swiftForMarkdownTransformers,
} from "./markdown";

test("the committed markdown transformers are a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(MARKDOWN_TRANSFORMERS_PATH).text();
  expect(committed).toBe(swiftForMarkdownTransformers(createTransformers()));
});

test("names a transformer by the name its package exports it by", () => {
  const swift = swiftForMarkdownTransformers([HEADING]);

  expect(swift).toContain(
    'MarkdownTransformer(kind: .element, name: .heading, regExp: JSRegExp("^(#{1,6})\\\\s", flags: ""), triggerOnEnter: true)',
  );
  expect(swift).toContain('case heading = "HEADING"');
});

test("refuses a regular expression that keeps where it last matched", () => {
  const sticky: Transformer = { ...HEADING, regExp: /^#\s/g };

  expect(() => swiftForMarkdownTransformers([sticky])).toThrow(
    "keeps where it last matched",
  );
});
