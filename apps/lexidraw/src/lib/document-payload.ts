/** Content safety errors stop a save; they never select a blank fallback. */
export class InvalidDocumentPayloadError extends Error {
  constructor(message = "Invalid document payload") {
    super(message);
    this.name = "InvalidDocumentPayloadError";
  }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const fail = (): never => {
  throw new InvalidDocumentPayloadError();
};

function stringBytes(value: string): Uint8Array {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
  }
  return encoder.encode(value);
}
function textOf(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return fail();
  }
}

type Span = { start: number; end: number };
type Kind = "object" | "array" | "scalar";

/** Scan bytes, materializing only object keys, never retained metadata values. */
function rootSpan(bytes: Uint8Array): Span {
  textOf(bytes);
  let cursor = 0;
  let budget = 1_000_000;
  let root: Span | undefined;
  const consume = () => {
    if (--budget < 0) fail();
  };
  const whitespace = () => {
    while (
      bytes[cursor] === 32 ||
      bytes[cursor] === 9 ||
      bytes[cursor] === 10 ||
      bytes[cursor] === 13
    )
      cursor++;
  };
  const expect = (byte: number) => {
    if (bytes[cursor++] !== byte) fail();
  };
  const digit = (byte: number | undefined) =>
    byte !== undefined && byte >= 48 && byte <= 57;
  const hex = (byte: number | undefined) =>
    byte !== undefined &&
    ((byte >= 48 && byte <= 57) ||
      (byte >= 65 && byte <= 70) ||
      (byte >= 97 && byte <= 102));
  const string = (): Span => {
    const start = cursor;
    expect(34);
    while (cursor < bytes.length) {
      const byte = bytes[cursor++];
      if (byte === 34) return { start, end: cursor };
      if (byte === undefined || byte < 32) fail();
      if (byte === 92) {
        const escapeByte = bytes[cursor++];
        if (escapeByte === 117) {
          for (let i = 0; i < 4; i++) if (!hex(bytes[cursor++])) fail();
        } else if (
          escapeByte !== 34 &&
          escapeByte !== 92 &&
          escapeByte !== 47 &&
          escapeByte !== 98 &&
          escapeByte !== 102 &&
          escapeByte !== 110 &&
          escapeByte !== 114 &&
          escapeByte !== 116
        )
          fail();
      }
    }
    return fail();
  };
  const value = (depth: number, envelope = false, rootObject = false): Kind => {
    if (depth > 256) fail();
    consume();
    whitespace();
    const first = bytes[cursor];
    if (first === 123) {
      cursor++;
      const keys = new Set<string>();
      let children = false;
      whitespace();
      if (bytes[cursor] !== 125) {
        for (;;) {
          consume();
          const token = string();
          const key: string = JSON.parse(
            textOf(bytes.subarray(token.start, token.end)),
          );
          if (keys.has(key)) fail();
          keys.add(key);
          whitespace();
          expect(58);
          whitespace();
          const start = cursor;
          const isRoot = envelope && key === "root";
          const kind = value(depth + 1, false, isRoot);
          if (isRoot) {
            if (kind !== "object") fail();
            root = { start, end: cursor };
          }
          if (rootObject && key === "children") {
            if (kind !== "array") fail();
            children = true;
          }
          whitespace();
          if (bytes[cursor] !== 44) break;
          cursor++;
          whitespace();
        }
      }
      expect(125);
      if (rootObject && !children) fail();
      return "object";
    }
    if (first === 91) {
      cursor++;
      whitespace();
      if (bytes[cursor] !== 93) {
        for (;;) {
          value(depth + 1);
          whitespace();
          if (bytes[cursor] !== 44) break;
          cursor++;
        }
      }
      expect(93);
      return "array";
    }
    if (first === 34) {
      string();
      return "scalar";
    }
    for (const literal of ["true", "false", "null"]) {
      if (first === literal.charCodeAt(0)) {
        for (let i = 0; i < literal.length; i++) expect(literal.charCodeAt(i));
        return "scalar";
      }
    }
    if (first === 45) cursor++;
    if (bytes[cursor] === 48) cursor++;
    else {
      const leading = bytes[cursor];
      if (leading === undefined || leading < 49 || leading > 57) fail();
      do {
        cursor++;
      } while (digit(bytes[cursor]));
    }
    if (bytes[cursor] === 46) {
      cursor++;
      if (!digit(bytes[cursor])) fail();
      do {
        cursor++;
      } while (digit(bytes[cursor]));
    }
    if (bytes[cursor] === 69 || bytes[cursor] === 101) {
      cursor++;
      if (bytes[cursor] === 43 || bytes[cursor] === 45) cursor++;
      if (!digit(bytes[cursor])) fail();
      do {
        cursor++;
      } while (digit(bytes[cursor]));
    }
    return "scalar";
  };
  if (value(1, true) !== "object") fail();
  whitespace();
  if (cursor !== bytes.length || !root) return fail();
  return root;
}

export function editorRootPayload(serializedEditorState: string): string {
  const bytes = stringBytes(serializedEditorState);
  const span = rootSpan(bytes);
  return `{"root":${textOf(bytes.subarray(span.start, span.end))}}`;
}

export function replaceDocumentRoot(
  current: Uint8Array,
  replacement: { kind: "replace-root"; elements: string },
): Uint8Array {
  const oldRoot = rootSpan(current);
  const incoming = stringBytes(replacement.elements);
  const newRoot = rootSpan(incoming);
  const length = newRoot.end - newRoot.start;
  const output = new Uint8Array(
    oldRoot.start + length + current.length - oldRoot.end,
  );
  output.set(current.subarray(0, oldRoot.start));
  output.set(incoming.subarray(newRoot.start, newRoot.end), oldRoot.start);
  output.set(current.subarray(oldRoot.end), oldRoot.start + length);
  return output;
}

/** Must run on the BLOB-only projection before the driver ever fetches TEXT. */
export function normalizeDocumentBytes(
  raw: unknown,
  storageType: unknown,
): { bytes: Uint8Array; text: string } {
  if (storageType !== "text") fail();
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : fail();
  rootSpan(bytes);
  return { bytes, text: textOf(bytes) };
}
