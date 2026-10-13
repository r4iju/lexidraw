/// <reference types="bun" />
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  editorRootPayload,
  replaceDocumentRoot,
  normalizeDocumentBytes,
} from "./document-payload";
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/document-payload-write-v1/${name}`, import.meta.url),
    "utf8",
  );
test("root replacement conserves the independent literal byte oracle", () => {
  expect(
    decode(
      replaceDocumentRoot(encode(fixture("legacy-metadata.json")), {
        kind: "replace-root",
        elements: fixture("replacement-root.json"),
      }),
    ),
  ).toBe(fixture("expected-splice.json"));
});
test("projection discards incoming metadata and retains exact root representation", () => {
  expect(
    editorRootPayload(
      ' {"tts":null,"\\u0072oot" : { "children" : [],"nodeVersion":42 },"unknown":1.00} ',
    ),
  ).toBe('{"root":{ "children" : [],"nodeVersion":42 }}');
});
test("arbitrary valid metadata grammar stays opaque including escaped surrogate and huge number", () => {
  const current =
    '\t{"unknown": { "n": -1.00e+999, "text":"雪 a\\"b \\uD800", "list":[true,false,null,{}] },"\\u0072oot": {"children":[]} }\r\n';
  expect(
    decode(
      replaceDocumentRoot(encode(current), {
        kind: "replace-root",
        elements: '{"root":{"children":[{"type":"modern"}]}}',
      }),
    ),
  ).toBe(
    '\t{"unknown": { "n": -1.00e+999, "text":"雪 a\\"b \\uD800", "list":[true,false,null,{}] },"\\u0072oot": {"children":[{"type":"modern"}]} }\r\n',
  );
});
test("normalization honors views and rejects unsafe encoding or storage", () => {
  const raw = encode('xx{"root":{"children":[]}}yy');
  expect(
    normalizeDocumentBytes(raw.subarray(2, raw.length - 2), "text").text,
  ).toBe('{"root":{"children":[]}}');
  expect(
    normalizeDocumentBytes(encode('{"root":{"children":[]}}').buffer, "text")
      .text,
  ).toBe('{"root":{"children":[]}}');
  for (const raw of [Uint8Array.of(0xff), Uint8Array.of(0xc3, 0x28), null])
    expect(() => normalizeDocumentBytes(raw, "text")).toThrow();
  expect(() =>
    normalizeDocumentBytes(encode('{"root":{"children":[]}}'), "blob"),
  ).toThrow();
});
test("literal unpaired UTF16 cannot be silently repaired by string encoding", () => {
  expect(() =>
    editorRootPayload('{"root":{"children":[]},"x":"\uD800"}'),
  ).toThrow();
  expect(() =>
    editorRootPayload('{"root":{"children":[]},"x":"\uDC00"}'),
  ).toThrow();
});
