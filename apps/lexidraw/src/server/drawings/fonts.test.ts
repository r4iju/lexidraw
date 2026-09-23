/// <reference types="bun" />
import { describe, expect, it } from "bun:test";

import { excalidrawFontFiles } from "./fonts";
import { EXCALIDRAW_FONT_FAMILIES } from "./fonts.generated";

/**
 * `FONT_FAMILY` in the pinned `@excalidraw/excalidraw`, as the family names it
 * writes into a `font-family` attribute. Spelled out rather than imported
 * because the editor does not export it, and because a version that adds a
 * family should fail here rather than quietly render it in the wrong face.
 */
const EDITOR_FAMILIES = [
  "Virgil",
  "Helvetica",
  "Cascadia",
  "Excalifont",
  "Nunito",
  "Lilita One",
  "Comic Shanns",
  "Liberation Sans",
];

describe("bundled fonts", () => {
  it("maps every family the editor can write", () => {
    expect(Object.keys(EXCALIDRAW_FONT_FAMILIES).toSorted()).toEqual(
      EDITOR_FAMILIES.toSorted(),
    );
  });

  it("maps each of them onto a bundled face's own family name", async () => {
    const bundled = new Set<string>();
    for (const file of excalidrawFontFiles()) {
      const names = readNames(await Bun.file(file).bytes());
      const family = names.get(16) ?? names.get(1);
      if (family) bundled.add(family);
    }
    // A name no face answers to is a silent fallback at render time, which is
    // what the map exists to prevent; the rasteriser reports nothing.
    for (const [family, mapped] of Object.entries(EXCALIDRAW_FONT_FAMILIES)) {
      expect([family, bundled.has(mapped)]).toEqual([family, true]);
    }
  });
});

/**
 * A face's `name` table, by name id: 1 is the family, 16 the typographic
 * family a weight-suffixed face belongs to. Read the way
 * `scripts/sync-excalidraw-fonts.ts` reads it, which is what wrote the map,
 * and the way a rasteriser matching a `font-family` reads it too.
 */
function readNames(ttf: Uint8Array): Map<number, string> {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const names = new Map<number, string>();
  const tables = view.getUint16(4);
  let table: number | undefined;
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...ttf.subarray(record, record + 4));
    if (tag === "name") table = view.getUint32(record + 8);
  }
  if (table === undefined) return names;

  const count = view.getUint16(table + 2);
  const storage = table + view.getUint16(table + 4);
  for (let index = 0; index < count; index++) {
    const record = table + 6 + index * 12;
    const platform = view.getUint16(record);
    const id = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const offset = view.getUint16(record + 10);
    if (names.has(id)) continue;
    names.set(
      id,
      new TextDecoder(platform === 1 ? "latin1" : "utf-16be").decode(
        ttf.subarray(storage + offset, storage + offset + length),
      ),
    );
  }
  return names;
}
