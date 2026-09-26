import { expect, test } from "bun:test";
import { enumValue, numberValue, stringValue, unionValue } from "lexical";
import { openObjectValue } from "./schema-values.js";

const note = openObjectValue({
  kind: enumValue(["note"]),
  text: stringValue(),
  votes: numberValue(),
});

test("an open object reads the fields it declares and keeps the rest as they are", () => {
  expect(note({ kind: "note", text: 5, extra: { deep: [1] } })).toEqual({
    kind: "note",
    text: "",
    votes: 0,
    extra: { deep: [1] },
  });
  expect(note("not an object")).toEqual({ kind: "note", text: "", votes: 0 });
});

test("a union picks an open object for a value with keys it doesn't declare", () => {
  const either = unionValue([
    openObjectValue({ kind: enumValue(["link"]), url: stringValue() }),
    note,
  ]);

  expect(either({ kind: "note", text: "a", votes: 1, extra: true })).toEqual({
    kind: "note",
    text: "a",
    votes: 1,
    extra: true,
  });
});
