/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { SceneEdits } from "./scene-edits";

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
});
