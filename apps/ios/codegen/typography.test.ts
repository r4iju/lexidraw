import { expect, test } from "bun:test";
import {
  DOCUMENT_TYPOGRAPHY_PATH,
  readWebStyles,
  srgbForOklch,
  swiftForTypography,
} from "./typography";

test("the committed typography is a fresh codegen of the web's stylesheets", async () => {
  const committed = await Bun.file(DOCUMENT_TYPOGRAPHY_PATH).text();
  expect(committed).toBe(swiftForTypography(await readWebStyles()));
});

test("reads a heading as its rules give it", async () => {
  const swift = swiftForTypography(await readWebStyles());

  expect(swift).toContain(
    ".h2: Heading(fontSize: 1.5, lineHeight: 1.3, letterSpacing: -0.01, before: 1.6, after: 0.4, color: .heading),",
  );
  expect(swift).toContain(
    ".h6: Heading(fontSize: 0.875, lineHeight: 1.5, letterSpacing: nil, before: 1.25, after: 0.25, color: .mutedForeground),",
  );
  expect(swift).toContain(
    "narrow: [Narrow(width: 639, headingSizes: [.h1: 1.625])],",
  );
});

test("a quote's border falls back as var() does", async () => {
  const swift = swiftForTypography(await readWebStyles());

  expect(swift).toContain(
    "quote: Quote(borderWidth: 3, borderColor: .border, paddingStart: 1)",
  );
});

test("refuses a stylesheet without a rule it reads", async () => {
  const styles = await readWebStyles();
  const documentCSS = styles.documentCSS.replace(
    /\.document-content hr \{[^}]*\}/,
    "",
  );

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    ".document-content hr",
  );
});

test("converts OKLCH to sRGB", () => {
  expect(srgbForOklch(1, 0, 0)).toEqual([1, 1, 1]);
  expect(srgbForOklch(0, 0, 0)).toEqual([0, 0, 0]);
  const red = srgbForOklch(0.627955, 0.257683, 29.2339);
  expect(red.map((channel) => Math.round(channel * 1000) / 1000)).toEqual([
    1, 0, 0,
  ]);
});

test("refuses a theme without dark colours on the screen", async () => {
  const styles = await readWebStyles();
  const globalsCSS = styles.globalsCSS.replace(
    /(@media screen \{\s*)\.dark \{/,
    "$1.dim {",
  );

  expect(() => swiftForTypography({ ...styles, globalsCSS })).toThrow(".dark");
});

test("a heading's letter-spacing falls back to the shared heading rule", async () => {
  const styles = await readWebStyles();
  const documentCSS = styles.documentCSS.replace(
    /(\.document-content :is\(h1, h2, h3, h4, h5, h6\):not\(\[data-lexical-decorator\] \*\) \{)/,
    "$1\n  letter-spacing: 0.01em;",
  );

  expect(swiftForTypography({ ...styles, documentCSS })).toContain(
    ".h3: Heading(fontSize: 1.25, lineHeight: 1.4, letterSpacing: 0.01,",
  );
});

test("refuses a paragraph whose space isn't every block's", async () => {
  const styles = await readWebStyles();
  const documentCSS = styles.documentCSS.replace(
    /(\.document-content p:not\(\[data-lexical-decorator\] \*\) \{\s*margin-block:)[^;]*;/,
    "$1 0 1em;",
  );

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    ".document-content p",
  );
});

test("reads every narrow container's headings", async () => {
  const styles = await readWebStyles();
  const documentCSS = `${styles.documentCSS}
@container (max-width: 390px) {
  .document-content h2:not([data-lexical-decorator] *) {
    font-size: 1.375em;
  }
}`;

  expect(swiftForTypography({ ...styles, documentCSS })).toContain(
    "narrow: [Narrow(width: 639, headingSizes: [.h1: 1.625]), Narrow(width: 390, headingSizes: [.h2: 1.375])],",
  );
});

test.each([
  ["(max-width: 390px)", "line-height: 1.2;"],
  ["(min-width: 1280px)", "font-size: 2em;"],
])(
  "refuses a heading a container sets as isn't read: %p %p",
  async (params, declaration) => {
    const styles = await readWebStyles();
    const documentCSS = `${styles.documentCSS}
@container ${params} {
  .document-content h1:not([data-lexical-decorator] *) {
    ${declaration}
  }
}`;

    expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
      `@container ${params}`,
    );
  },
);

test("refuses a narrow container's heading inside another at-rule", async () => {
  const styles = await readWebStyles();
  const documentCSS = `${styles.documentCSS}
@media (pointer: fine) {
  @container (max-width: 390px) {
    .document-content h1:not([data-lexical-decorator] *) {
      font-size: 1.5em;
    }
  }
}`;

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    "@container (max-width: 390px)",
  );
});

test("reads the body text of a document in a language the web sets apart", async () => {
  const styles = await readWebStyles();
  const documentCSS = `${styles.documentCSS}
.document-typography:lang(ko),
.document-content:lang(ko) {
  line-height: 1.7;
}`;
  const swift = swiftForTypography({ ...styles, documentCSS });

  expect(swift).toContain("    letterSpacing: 0,\n");
  expect(swift).toContain(
    'languages: [Language(tags: ["ja", "zh"], lineHeight: 1.8, letterSpacing: 0.02), Language(tags: ["ko"], lineHeight: 1.7, letterSpacing: nil)],',
  );
});

test("refuses a language's text set as isn't read", async () => {
  const styles = await readWebStyles();
  const documentCSS = `${styles.documentCSS}
.document-content:lang(ko) p {
  letter-spacing: 0.01em;
}`;

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    ".document-content:lang(ko) p",
  );
});

test("reads a list and a checklist as their rules give them", async () => {
  const swift = swiftForTypography(await readWebStyles());

  expect(swift).toContain(
    "list: List(padding: 1.625, itemSpacing: 0.25, markerColor: .mutedForeground, checklistPadding: 1.75, " +
      "box: Box(top: 0.3, size: 1, borderWidth: 1.5, borderColor: .mutedForeground, cornerRadius: 4, " +
      "checkedColor: .primary, tick: Tick(left: 0.34, top: 0.45, width: 0.3, height: 0.5, lineWidth: 1.5, " +
      "color: .primaryForeground)), doneColor: .mutedForeground),",
  );
});

test("refuses a nested list spaced other than an item", async () => {
  const styles = await readWebStyles();
  const documentCSS = styles.documentCSS.replace(
    /(\.document-content li :is\(ul, ol\):not\(\[data-lexical-decorator\] \*\) \{\s*margin-block:)[^;]*;/,
    "$1 0.5em 0;",
  );

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    ".document-content li :is(ul, ol)",
  );
});

test.each([
  [
    ".document-content li:not([data-lexical-decorator] *)",
    "margin-block: 0;",
    "margin-block: 0.5em 0;",
  ],
  [
    ".document-content li.document-task",
    "padding-inline: 1.75em 0;",
    "padding-inline: 1.75em 1em;",
  ],
  [
    ".document-task::before",
    "inset-inline-start: 0;",
    "inset-inline-start: 0.25em;",
  ],
  [
    ".document-task-done",
    "text-decoration: line-through;",
    "text-decoration: underline;",
  ],
  [
    ".document-task-done::after",
    "transform: rotate(45deg);",
    "transform: rotate(30deg);",
  ],
])("refuses a list whose %p sets other than %p", async (selector, from, to) => {
  const styles = await readWebStyles();
  const rule = styles.documentCSS.indexOf(`\n${selector} {`);
  const at = styles.documentCSS.indexOf(from, rule);
  expect(rule).toBeGreaterThan(-1);
  expect(at).toBeGreaterThan(rule);
  const documentCSS =
    styles.documentCSS.slice(0, at) +
    to +
    styles.documentCSS.slice(at + from.length);

  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    selector,
  );
});

test("reads a link's colour and underline", async () => {
  const swift = swiftForTypography(await readWebStyles());

  expect(swift).toContain(
    "link: Link(color: .primary, underlineThickness: 1, underlineOffset: 0.2, underlineOpacity: 0.4))",
  );
});

test.each([
  ["text-decoration: underline 1px;", "text-decoration: underline wavy 1px;"],
  ["text-underline-offset: 0.2em;", "text-underline-offset: auto;"],
  [
    "text-underline-offset: 0.2em;",
    "text-underline-offset: 0.2em; text-decoration-skip-ink: none;",
  ],
  [
    "text-decoration-color: color-mix(in oklab, currentColor 40%, transparent);",
    "text-decoration-color: var(--border);",
  ],
])("refuses a link underlined as isn't read: %p", async (from, to) => {
  const styles = await readWebStyles();
  const documentCSS = styles.documentCSS.replace(from, to);

  expect(documentCSS).not.toBe(styles.documentCSS);
  expect(() => swiftForTypography({ ...styles, documentCSS })).toThrow(
    ".document-link",
  );
});
