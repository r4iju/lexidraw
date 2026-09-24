/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createContext, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = [
  "window",
  "document",
  "navigator",
  "Event",
  "CustomEvent",
] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];

// Both reach tRPC and the validated env, which must not load in a window: the
// modules are shared with the server tests this process runs too.
let autoSave = false;
mock.module("./use-auto-save", () => ({
  useAutoSave: () => ({ enabled: autoSave }),
}));
mock.module("./use-open-entity-sync", () => ({
  OpenEntityContext: createContext(null),
}));
// Radix settles at its first import whether it has a DOM, and another test
// imports it without one; the question is what is under test, not its look.
const Plain = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
mock.module("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: Plain,
  DialogDescription: Plain,
  DialogFooter: Plain,
  DialogHeader: Plain,
  DialogTitle: Plain,
}));

let UnsavedChangesProvider: typeof import("./use-unsaved-changes").UnsavedChangesProvider;
let useUnsavedChanges: typeof import("./use-unsaved-changes").useUnsavedChanges;
let leaveThen: typeof import("~/lib/leave-guard").leaveThen;

beforeAll(async () => {
  // The dialog reaches for much of the DOM: everything the window has that
  // this process lacks, taken back after.
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ UnsavedChangesProvider, useUnsavedChanges } = await import(
    "./use-unsaved-changes"
  ));
  ({ leaveThen } = await import("~/lib/leave-guard"));
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

function Edited() {
  const { markDirty } = useUnsavedChanges();
  useEffect(markDirty, [markDirty]);
  return null;
}

function button(name: string) {
  const found = [...dom.window.document.querySelectorAll("button")].find(
    (b) => b.textContent === name,
  );
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

describe("the question leaving an editor puts", () => {
  test("still leaves when the page re-renders while it is up", async () => {
    const root = createRoot(
      dom.window.document.body.appendChild(
        dom.window.document.createElement("div"),
      ),
    );
    const page = (saveBeforeLeaving: () => Promise<boolean>) => (
      <UnsavedChangesProvider saveBeforeLeaving={saveBeforeLeaving}>
        <Edited />
      </UnsavedChangesProvider>
    );
    await act(async () => root.render(page(async () => true)));

    let went = 0;
    await act(async () => leaveThen(() => went++));
    expect(button("Leave")).toBeDefined();
    // The autosave setting loads, and the page hands down a new save.
    autoSave = true;
    await act(async () => root.render(page(async () => true)));
    await act(async () => button("Leave").click());
    expect(went).toBe(1);
    await act(async () => root.unmount());
  });
});
