/// <reference types="bun" />
/**
 * Rebuilds `src/server/drawings/fonts` from the pinned `@excalidraw/excalidraw`.
 *
 * PNG rendering rasterises the exported SVG with resvg, which reads fonts from
 * files and understands TrueType, not the WOFF2 the editor ships for the
 * browser. The files here are those same WOFF2 faces decompressed, so a label
 * rasterises with the font the editor drew it in. They are checked in because
 * the render path reads them from disk at request time: generating them during
 * the build would add a build step whose output still has to be traced into
 * the function.
 *
 * Also written: `fonts.generated.ts`, which carries the load order and the map
 * from the family names Excalidraw writes into an SVG to the names the bundled
 * faces answer to, and `fonts/LICENSES.md`.
 *
 * Run `bun run fonts:sync` after bumping `@excalidraw/excalidraw`, which is
 * pinned by the root `overrides`; the faces are content-hashed, so a bump that
 * changes a font shows up as added and removed files.
 *
 * Xiaolai, the CJK fallback, is deliberately left out: it is 200 faces and
 * 25 MB of subsets, which is not worth carrying into every deployment for a
 * drawing that has no CJK text in it. CJK labels render in the PNG's fallback
 * font instead.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decompress } from "wawoff2";

const SOURCE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "excalidraw-converter",
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "prod",
  "fonts",
);

const TARGET = join(
  import.meta.dir,
  "..",
  "src",
  "server",
  "drawings",
  "fonts",
);

const SKIPPED = new Set(["Xiaolai"]);

/**
 * Load order, which is also resvg's search order: it takes the first face
 * whose family matches, and for a character that face has no glyph for, the
 * first face in the whole set that does. The hand-drawn families come first so
 * that a character outside the chosen face's subset is answered by a face that
 * still looks like the drawing, rather than by whichever family sorted first.
 * A family missing from here is appended, so a new one is rendered rather than
 * silently dropped.
 */
const FAMILY_ORDER = [
  "Excalifont",
  "Virgil",
  "ComicShanns",
  "Nunito",
  "Liberation",
  "Cascadia",
  "Lilita",
  "Assistant",
];

/**
 * Every family in the pinned editor's `FONT_FAMILY`, and the directory whose
 * faces are to answer for it. The names on the left are what `exportToSvg`
 * writes into a `font-family` attribute; the faces answer to whatever their
 * own name tables say, which for half of these is something else entirely.
 *
 * `Helvetica` is the substitution: the editor lists it as a local font and
 * ships no face for it, counting on the system to have one, and a server has
 * none. Liberation Sans is metric-compatible with Helvetica and Arial, so the
 * text keeps the advance widths the editor laid it out with.
 */
const DRAWING_FAMILIES: [family: string, directory: string][] = [
  ["Excalifont", "Excalifont"],
  ["Virgil", "Virgil"],
  ["Comic Shanns", "ComicShanns"],
  ["Nunito", "Nunito"],
  ["Liberation Sans", "Liberation"],
  ["Helvetica", "Liberation"],
  ["Cascadia", "Cascadia"],
  ["Lilita One", "Lilita"],
];

/** What each directory's faces are licensed under, and by whom. */
const LICENCES: Record<string, { licence: string; note: string }> = {
  Assistant: { licence: "OFL-1.1", note: "The Assistant Project Authors." },
  Cascadia: { licence: "OFL-1.1", note: "Microsoft Corporation." },
  ComicShanns: {
    licence: "MIT",
    note: "Shannon Miwa, with later contributors named in the face itself.",
  },
  Excalifont: {
    licence: "MIT, as part of @excalidraw/excalidraw",
    note: "Excalidraw's own face. Its name table reserves all rights, and the package that ships it is MIT; this copy is redistributed from that package, which this app already renders drawings with in the browser.",
  },
  Liberation: { licence: "OFL-1.1", note: "Red Hat, Inc." },
  Lilita: { licence: "OFL-1.1", note: "Juan Montoreano, via Google Fonts." },
  Nunito: { licence: "OFL-1.1", note: "Vernon Adams, via Google Fonts." },
  Virgil: { licence: "OFL-1.1", note: "Excalidraw's first hand-drawn face." },
};

/**
 * How much of the Latin alphabet the face carries, as the number of probes
 * its character map answers. `A` alone does not separate the subsets: every
 * Google subset of Nunito has it, and only the Latin one has `é`. Read out
 * of the font because the subsets are named by content hash upstream, so
 * nothing else says which is which. Only the two unicode subtable formats the
 * editor's fonts use are understood; a face in any other format scores zero,
 * which costs it the first place in its family and nothing else.
 */
const PROBES = [0x41, 0xe9];

type Face = {
  file: string;
  latin: number;
  /** The name resvg matches a `font-family` against. */
  family: string;
  copyright: string;
  licenceUrl: string | undefined;
};

const directories = (await readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !SKIPPED.has(entry.name))
  .map((entry) => entry.name)
  .toSorted((a, b) => rank(a) - rank(b));

function rank(directory: string): number {
  const index = FAMILY_ORDER.indexOf(directory);
  return index === -1 ? FAMILY_ORDER.length : index;
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });

const bundled = new Map<string, Face[]>();
let total = 0;
for (const directory of directories) {
  const faces: Face[] = [];
  for (const file of (await readdir(join(SOURCE, directory))).toSorted()) {
    if (!file.endsWith(".woff2")) continue;
    const woff2 = await Bun.file(join(SOURCE, directory, file)).bytes();
    const ttf = await decompress(woff2);
    const name = `${file.slice(0, -".woff2".length)}.ttf`;
    await writeFile(join(TARGET, name), ttf);
    const strings = readNames(ttf);
    faces.push({
      file: name,
      latin: latinScore(ttf),
      // Name 16 when the face has it, because that is the family a face in a
      // weight-suffixed family belongs to, and what resvg matches: Nunito's
      // faces call themselves "Nunito ExtraLight Medium" under name 1.
      family: strings.get(16) ?? strings.get(1) ?? "",
      copyright: strings.get(0) ?? "",
      licenceUrl: strings.get(14),
    });
    total += ttf.length;
  }
  // Each family is split into subsets by unicode range, and which one a
  // hashed name holds is not visible from the name. The one carrying the
  // Latin alphabet goes first, because that is the one resvg answers the
  // family with.
  faces.sort((a, b) => b.latin - a.latin);
  bundled.set(directory, faces);
  console.log(
    `${directory}: ${faces.length} faces as "${faces[0]?.family}", first ${faces[0]?.file}`,
  );
}

const ordered = [...bundled.values()].flatMap((faces) =>
  faces.map((face) => face.file),
);

const mapped = DRAWING_FAMILIES.map(([family, directory]) => {
  const face = bundled.get(directory)?.[0];
  if (!face?.family) {
    throw new Error(`No bundled face for "${family}" in ${directory}`);
  }
  return [family, face.family] as const;
});

await writeFile(
  join(TARGET, "..", "fonts.generated.ts"),
  `// Generated by scripts/sync-excalidraw-fonts.ts; do not edit.\n` +
    `export const EXCALIDRAW_FONT_FILES = [\n` +
    ordered.map((name) => `  ${JSON.stringify(name)},\n`).join("") +
    `] as const;\n\n` +
    `/**\n` +
    ` * Every family Excalidraw writes into an exported SVG, mapped to the name\n` +
    ` * the bundled face answers to. They differ often enough that leaving one\n` +
    ` * unmapped is how text silently comes out in the default font.\n` +
    ` */\n` +
    `export const EXCALIDRAW_FONT_FAMILIES: Record<string, string> = {\n` +
    mapped
      .map(([from, to]) => `  ${key(from)}: ${JSON.stringify(to)},\n`)
      .join("") +
    `};\n`,
);

await writeFile(join(TARGET, "LICENSES.md"), licenses());

console.log(
  `${directories.length} directories, ${ordered.length} faces, ${(total / 1024 / 1024).toFixed(1)} MB`,
);

/** An object key, quoted only where a bare identifier would not parse. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function licenses(): string {
  const sections = directories.map((directory) => {
    const faces = bundled.get(directory) ?? [];
    const { licence, note } = LICENCES[directory] ?? {
      licence: "unknown — check before shipping",
      note: "",
    };
    const copyrights = [...new Set(faces.map((face) => face.copyright))];
    const url = faces.find((face) => face.licenceUrl)?.licenceUrl;
    return [
      `## ${faces[0]?.family ?? directory}`,
      "",
      `- Licence: ${licence}${url ? ` (${url})` : ""}`,
      `- ${note}`,
      `- Files: ${faces.length}, named \`${directory}*\` or as upstream hashes them.`,
      "",
      "```text",
      ...copyrights,
      "```",
      "",
    ].join("\n");
  });

  return [
    "# Font licences",
    "",
    "These faces are the WOFF2 fonts from the pinned `@excalidraw/excalidraw`,",
    "decompressed to TrueType so resvg can read them; nothing else about them",
    "was modified, and none was renamed. They are used server-side to rasterise",
    "a drawing, which is what the editor does with them in the browser.",
    "",
    "Generated by `apps/lexidraw/scripts/sync-excalidraw-fonts.ts`; the",
    "copyright blocks are each family's own `name` table, quoted verbatim.",
    "",
    ...sections,
    "## SIL Open Font License 1.1",
    "",
    "```text",
    ofl(),
    "```",
    "",
    "## MIT License",
    "",
    "```text",
    mit(),
    "```",
    "",
  ].join("\n");
}

/**
 * The `name` table, as the ids this script cares about: 0 copyright,
 * 1 family, 14 licence URL, 16 typographic family.
 */
function readNames(ttf: Uint8Array): Map<number, string> {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const table = findTable(ttf, view, "name");
  const strings = new Map<number, string>();
  if (table === undefined) return strings;

  const count = view.getUint16(table + 2);
  const storage = table + view.getUint16(table + 4);
  for (let index = 0; index < count; index++) {
    const record = table + 6 + index * 12;
    const platform = view.getUint16(record);
    const id = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const offset = view.getUint16(record + 10);
    if (strings.has(id)) continue;
    const bytes = ttf.subarray(storage + offset, storage + offset + length);
    // Everything but Macintosh (1) stores UTF-16BE here.
    strings.set(
      id,
      new TextDecoder(platform === 1 ? "latin1" : "utf-16be").decode(bytes),
    );
  }
  return strings;
}

function findTable(
  ttf: Uint8Array,
  view: DataView,
  tag: string,
): number | undefined {
  const count = view.getUint16(4);
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16;
    const found = String.fromCharCode(...ttf.subarray(record, record + 4));
    if (found === tag) return view.getUint32(record + 8);
  }
  return undefined;
}

function latinScore(ttf: Uint8Array): number {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const cmap = findTable(ttf, view, "cmap");
  if (cmap === undefined) return 0;

  const subtables = view.getUint16(cmap + 2);
  const found = new Set<number>();
  for (let index = 0; index < subtables; index++) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const unicode =
      platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const table = cmap + view.getUint32(record + 4);
    for (const probe of PROBES) {
      if (covers(view, table, probe)) found.add(probe);
    }
  }
  return found.size;
}

function covers(view: DataView, offset: number, code: number): boolean {
  const format = view.getUint16(offset);
  if (format === 4) {
    const segments = view.getUint16(offset + 6) / 2;
    for (let segment = 0; segment < segments; segment++) {
      const end = view.getUint16(offset + 14 + segment * 2);
      const start = view.getUint16(offset + 16 + segments * 2 + segment * 2);
      if (start <= code && code <= end && end !== 0xffff) return true;
    }
    return false;
  }
  if (format === 12) {
    const groups = view.getUint32(offset + 12);
    for (let group = 0; group < groups; group++) {
      const at = offset + 16 + group * 12;
      if (view.getUint32(at) <= code && code <= view.getUint32(at + 4)) {
        return true;
      }
    }
  }
  return false;
}

// Functions, not constants: the top-level code above calls licenses().
function ofl(): string {
  return `-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.`;
}

function mit(): string {
  return `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}
