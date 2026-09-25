/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createContext, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { setScreen } from "~/test/dom";

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
let UnsavedChangesProvider: typeof import("./use-unsaved-changes").UnsavedChangesProvider;
let useUnsavedChanges: typeof import("./use-unsaved-changes").useUnsavedChanges;
let useSaveStatus: typeof import("./use-unsaved-changes").useSaveStatus;
let leaveThen: typeof import("~/lib/leave-guard").leaveThen;
let OpenEntityContext: typeof import("./use-open-entity-sync").OpenEntityContext;

beforeAll(async () => {
  // The dialog reaches for much of the DOM: everything the window has that
  // this process lacks, taken back after.
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  setScreen({ width: 1280 });
  ({ UnsavedChangesProvider, useUnsavedChanges, useSaveStatus } = await import(
    "./use-unsaved-changes"
  ));
  ({ OpenEntityContext } = await import("./use-open-entity-sync"));
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

  test("offers Stay first and saving last", async () => {
    autoSave = false;
    const root = createRoot(
      dom.window.document.body.appendChild(
        dom.window.document.createElement("div"),
      ),
    );
    await act(async () =>
      root.render(
        <UnsavedChangesProvider saveBeforeLeaving={async () => true}>
          <Edited />
        </UnsavedChangesProvider>,
      ),
    );
    await act(async () => leaveThen(() => {}));
    const answers = [
      ...(dom.window.document
        .querySelector("[role=dialog]")
        ?.querySelectorAll("button") ?? []),
    ]
      .map((b) => b.textContent)
      .filter((label) => label !== "Close");
    expect(answers).toEqual(["Stay", "Leave", "Save and leave"]);
    await act(async () => button("Stay").click());
    await act(async () => root.unmount());
  });
});

describe("what the app bar says about saving", () => {
  /** A sync whose saves the test starts and lands by hand. */
  function fakeSync() {
    const listeners = new Set<() => void>();
    let saving = false;
    return {
      set saving(value: boolean) {
        saving = value;
        for (const listener of listeners) listener();
      },
      sync: {
        isSaving: () => saving,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        hasLocalEdits: () => false,
        holdsSaves: () => false,
        keep() {},
      },
    };
  }

  test("goes from Unsaved changes to Saving… to Saved", async () => {
    const fake = fakeSync();
    let edits: ReturnType<typeof useUnsavedChanges> | null = null;
    function Status() {
      edits = useUnsavedChanges();
      return <output>{useSaveStatus()}</output>;
    }
    const host = dom.window.document.createElement("div");
    dom.window.document.body.append(host);
    const root = createRoot(host);
    const open = { sync: fake.sync, noun: "document", resumers: new Set() };
    await act(async () =>
      root.render(
        <OpenEntityContext.Provider value={open as never}>
          <UnsavedChangesProvider saveBeforeLeaving={async () => true}>
            <Status />
          </UnsavedChangesProvider>
        </OpenEntityContext.Provider>,
      ),
    );
    const said = () => host.querySelector("output")?.textContent;
    expect(said()).toBe("saved");

    await act(async () => edits?.markDirty());
    expect(said()).toBe("unsaved");
    await act(async () => {
      fake.saving = true;
    });
    expect(said()).toBe("saving");
    await act(async () => {
      edits?.markPristine();
      fake.saving = false;
    });
    expect(said()).toBe("saved");
    await act(async () => root.unmount());
  });

  test("says nothing to someone whose edits are not saved, a reader", async () => {
    function Status() {
      return <output>{useSaveStatus() ?? "none"}</output>;
    }
    const host = dom.window.document.createElement("div");
    dom.window.document.body.append(host);
    const root = createRoot(host);
    const open = {
      sync: fakeSync().sync,
      noun: "document",
      resumers: new Set(),
    };
    await act(async () =>
      root.render(
        <OpenEntityContext.Provider value={open as never}>
          <UnsavedChangesProvider saveBeforeLeaving={null}>
            <Status />
          </UnsavedChangesProvider>
        </OpenEntityContext.Provider>,
      ),
    );
    expect(host.querySelector("output")?.textContent).toBe("none");
    await act(async () => root.unmount());
  });

  test("says nothing where nothing is open to save", async () => {
    function Status() {
      return <output>{useSaveStatus() ?? "none"}</output>;
    }
    const host = dom.window.document.createElement("div");
    dom.window.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Status />));
    expect(host.querySelector("output")?.textContent).toBe("none");
    await act(async () => root.unmount());
  });
});
