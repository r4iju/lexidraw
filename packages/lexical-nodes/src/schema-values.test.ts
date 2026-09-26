import { expect, test } from "bun:test";
import {
  emptyOrStored,
  falseOrStored,
  rawValueOr,
  readsNullAsAbsent,
  storedValue,
} from "./schema-values.js";

test("a stored value is read as it was stored, whatever it is", () => {
  const stored = storedValue<unknown>();

  for (const value of ["a", 7, null, { deep: [1] }, undefined]) {
    expect(stored(value)).toBe(value);
  }
});

test("a stored value with a default reads absence as it, and null only where told to", () => {
  const plain = rawValueOr<unknown>("[]");
  const nullAbsent = rawValueOr("[]", { nullAsAbsent: true });

  expect(plain(undefined)).toBe("[]");
  expect(plain(null)).toBeNull();
  expect(plain(5)).toBe(5);
  expect(nullAbsent(null)).toBe("[]");
  expect(nullAbsent("x")).toBe("x");
  expect(readsNullAsAbsent(nullAbsent.meta)).toBe(true);
  expect(readsNullAsAbsent(plain.meta)).toBe(false);
});

test('`|| false` and `|| ""` read nothing as the empty value and anything else as stored', () => {
  const empty = emptyOrStored();

  expect(falseOrStored(undefined)).toBe(false);
  expect(falseOrStored(0)).toBe(false);
  expect<unknown>(falseOrStored("yes")).toBe("yes");
  expect(empty(null)).toBe("");
  expect(empty("left")).toBe("left");
  expect<unknown>(empty(3)).toBe(3);
});
