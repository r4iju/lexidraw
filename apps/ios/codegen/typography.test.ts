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
    '"h2": Heading(fontSize: 1.5, lineHeight: 1.3, letterSpacing: -0.01, before: 1.6, after: 0.4, color: .heading),',
  );
  expect(swift).toContain(
    '"h6": Heading(fontSize: 0.875, lineHeight: 1.5, letterSpacing: 0, before: 1.25, after: 0.25, color: .mutedForeground),',
  );
  expect(swift).toContain('narrowHeadingSizes: ["h1": 1.625]');
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
