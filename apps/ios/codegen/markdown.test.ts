import { expect, test } from "bun:test";
import { HEADING, LINK, type Transformer } from "@lexical/markdown";
import { BLOCK_EQUATION_FENCE } from "@packages/lexical-nodes/decorator-transformers";
import { createTransformers } from "@packages/lexical-nodes/transformers";
import {
  CALLOUT_ALIASES,
  MARKDOWN_PATTERNS,
  MARKDOWN_TRANSFORMERS_PATH,
  swiftForMarkdownTransformers,
} from "./markdown";

test("the committed markdown transformers are a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(MARKDOWN_TRANSFORMERS_PATH).text();
  expect(committed).toBe(
    swiftForMarkdownTransformers(
      createTransformers(),
      MARKDOWN_PATTERNS,
      CALLOUT_ALIASES,
    ),
  );
});

test("gives the kind each word a callout marker may name reads as", () => {
  const swift = swiftForMarkdownTransformers(
    [],
    {},
    {
      danger: "caution",
      hint: "tip",
    },
  );
  expect(swift).toContain(
    'static let calloutAliases: [String: CalloutKind] = ["danger": .caution, "hint": .tip]',
  );
});

test("gives a pattern the web exports by its name", () => {
  const swift = swiftForMarkdownTransformers([], {
    TABLE_ROW_DIVIDER_REG_EXP: /^\|-{3,}$/,
  });

  expect(swift).toContain(
    'static let tableRowDividerRegExp = JSRegExp("^\\\\|-{3,}$", flags: "")',
  );
});

test("names a transformer by the name its package exports it by", () => {
  const swift = swiftForMarkdownTransformers([HEADING]);

  expect(swift).toContain(
    'MarkdownTransformer(kind: .element, name: .heading, regExp: JSRegExp("^(#{1,6})\\\\s", flags: ""), triggerOnEnter: true, makes: ["heading"])',
  );
  expect(swift).toContain('case heading = "HEADING"');
});

test("refuses a regular expression that keeps where it last matched", () => {
  const sticky: Transformer = { ...HEADING, regExp: /^(#{1,6})\s/g };

  expect(() => swiftForMarkdownTransformers([sticky])).toThrow(
    "keeps where it last matched",
  );
});

test("names every transformer the web editor runs", () => {
  const swift = swiftForMarkdownTransformers(createTransformers());

  expect(swift).not.toContain("name: nil");
  expect(swift).toContain('case callout = "CALLOUT"');
  expect(swift).toContain('case table = "TABLE"');
  expect(swift).toContain('case footnoteReference = "FOOTNOTE_REFERENCE"');
});

test("refuses a transformer no package exports", () => {
  const unexported: Transformer = {
    ...HEADING,
    regExp: /^%\s/,
    replace: () => {},
  };

  expect(() => swiftForMarkdownTransformers([unexported])).toThrow(
    "No package exports the transformer /^%\\s/",
  );
});

test("lists the node types a transformer can make", () => {
  expect(swiftForMarkdownTransformers([HEADING])).toContain(
    'makes: ["heading"]',
  );
});

test("gives a text match the pattern it imports with", () => {
  const swift = swiftForMarkdownTransformers([LINK]);

  expect(swift).toContain(
    `importRegExp: JSRegExp("${LINK.importRegExp?.source.replace(/[\\"]/g, (character) => `\\${character}`)}", flags: "")`,
  );
});

test("refuses a text match that ends its match in code", () => {
  const ending: Transformer = { ...LINK, getEndIndex: () => false };

  expect(() => swiftForMarkdownTransformers([ending])).toThrow(
    "ends its match in code",
  );
});

test("gives a multiline element the pattern that ends it", () => {
  const swift = swiftForMarkdownTransformers([BLOCK_EQUATION_FENCE]);

  expect(swift).toContain(
    'regExp: JSRegExp("^\\\\s*\\\\$\\\\$\\\\s*$", flags: ""), regExpEnd: JSRegExp("^\\\\s*\\\\$\\\\$\\\\s*$", flags: ""), isEndRequired: true',
  );
});

test("gives a pattern that counts its matches its global flag", () => {
  const swift = swiftForMarkdownTransformers([], { OPEN: /<a>/gi });

  expect(swift).toContain('static let open = JSRegExp("<a>", flags: "gi")');
});
