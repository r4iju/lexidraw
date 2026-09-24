/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { SceneEdits, sceneKey } from "./scene-edits";

/** A stored rectangle, as far as a scene key reads it. */
const box = (version: number, more: Partial<ExcalidrawElement> = {}) =>
  ({
    id: "box",
    type: "rectangle",
    version,
    isDeleted: false,
    strokeColor: "#1e1e1e",
    ...more,
  }) as ExcalidrawElement;
const view = { viewBackgroundColor: "#ffffff", zoom: 1, scrollX: 0 };

// Scenes as `use-synced-excalidraw.ts` fingerprints them: `id@version`.
describe("which changes to an open drawing are the user's", () => {
  test("before the user touches the scene, Excalidraw's own changes are not edits", () => {
    const edits = new SceneEdits("a@1");
    // Text re-measured once the fonts arrive bumps versions.
    expect(edits.changed("a@2")).toBe(false);
    expect(edits.hasLocalEdits("a@2")).toBe(false);
  });

  test("after a touch a change is an edit, and undoing it is not", () => {
    const edits = new SceneEdits("a@1");
    edits.touched();
    expect(edits.changed("a@1,b@1")).toBe(true);
    expect(edits.hasLocalEdits("a@1,b@1")).toBe(true);
    expect(edits.changed("a@1")).toBe(false);
  });

  test("the onChange a replace causes schedules no save", () => {
    const edits = new SceneEdits("a@1");
    edits.touched();
    edits.changed("a@2");
    edits.replaced("r@1");
    expect(edits.changed("r@1")).toBe(false);
    expect(edits.hasLocalEdits("r@1")).toBe(false);
    // The replaced scene loads like any other: its font pass is not an edit.
    expect(edits.changed("r@2")).toBe(false);
  });

  test("a scene the server stores needs no saving again", () => {
    const edits = new SceneEdits("a@1");
    edits.touched();
    expect(edits.changed("a@1,b@1")).toBe(true);
    edits.saved("a@1,b@1");
    expect(edits.changed("a@1,b@1")).toBe(false);
    expect(edits.changed("a@1,b@1,c@1")).toBe(true);
  });

  test("a gesture that spans a reload stays the user's", () => {
    const edits = new SceneEdits("a@1");
    edits.pressed();
    edits.replaced("r@1");
    // The drag goes on over the reloaded scene.
    expect(edits.changed("r@2")).toBe(true);
    edits.released();
    edits.replaced("s@1");
    expect(edits.changed("s@2")).toBe(false);
  });
});

// What an open drawing's onChange saves: the scene key, touched.
describe("which drawing changes are something to save", () => {
  const opened = () => {
    const edits = new SceneEdits(sceneKey([box(1)], view));
    edits.touched();
    return edits;
  };

  test("a style change is", () => {
    const changed = box(2, { strokeColor: "#e03131" });
    expect(opened().changed(sceneKey([changed], view))).toBe(true);
  });

  test("a delete is", () => {
    const deleted = box(2, { isDeleted: true });
    expect(opened().changed(sceneKey([deleted], view))).toBe(true);
  });

  test("scrolling or zooming alone is not", () => {
    const moved = { ...view, zoom: 2, scrollX: 400 };
    expect(opened().changed(sceneKey([box(1)], moved))).toBe(false);
  });

  test("a new background colour is", () => {
    const green = { ...view, viewBackgroundColor: "#b2f2bb" };
    expect(opened().changed(sceneKey([box(1)], green))).toBe(true);
  });
});
