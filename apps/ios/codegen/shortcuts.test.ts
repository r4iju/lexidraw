import { expect, test } from "bun:test";
import { blockTypes, nativeInput, shortcutBindings } from "./shortcuts";

test("block choices retain web labels and its heading limit", () => {
  expect(blockTypes()).toContainEqual({ type: "h4", label: "Heading 4" });
  expect(blockTypes()).toContainEqual({ type: "code", label: "Code block" });
  expect(blockTypes().some(({ type }) => type === "h5")).toBe(false);
});

test("native bindings retain the web's formatting and list shortcuts", () => {
  const bindings = shortcutBindings();
  expect(bindings).toContainEqual({
    action: "strikeThrough",
    input: "s",
    command: true,
    shift: true,
    alternate: false,
  });
  expect(bindings).toContainEqual({
    action: "formatCheckList",
    input: "6",
    command: true,
    shift: false,
    alternate: true,
  });
  expect(bindings).toContainEqual({
    action: "clearFormatting",
    input: "\\",
    command: true,
    shift: false,
    alternate: false,
  });
  expect(
    bindings
      .filter(({ action }) => action === "formatHeading")
      .map(({ input }) => input),
  ).toEqual(["1", "2", "3"]);
});

test("unknown DOM key shapes refuse native shortcut generation", () => {
  expect(nativeInput("BracketRight")).toBe("]");
  expect(nativeInput("Numpad4")).toBe("4");
  expect(() => nativeInput("IntlYen")).toThrow("Unknown keyboard code");
});
