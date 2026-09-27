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
    ".h6: Heading(fontSize: 0.875, lineHeight: 1.5, letterSpacing: 0, before: 1.25, after: 0.25, color: .mutedForeground),",
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
