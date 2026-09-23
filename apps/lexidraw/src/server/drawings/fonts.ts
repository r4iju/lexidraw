import { existsSync } from "node:fs";
import { join } from "node:path";

import { EXCALIDRAW_FONT_FILES } from "./fonts.generated";

let directory: string | undefined;

/**
 * The editor's fonts as files on disk, in the order resvg is to search them.
 *
 * resvg reads fonts from paths, not from memory, so the faces are checked in
 * next to this module and `next.config.ts` traces them into the function that
 * serves a render. Where that function unpacks them is not something this can
 * assume, so both roots a Next server ever runs from are tried: the working
 * directory, which is the app root under `next dev`, `next start` and on
 * Vercel, and this module's own directory, which is what a test or a script
 * importing it directly has — and which a bundler is free to leave undefined,
 * so it is only a candidate when it survived. `scripts/sync-excalidraw-fonts.ts`
 * writes both the files and the order.
 */
export function excalidrawFontFiles(): string[] {
  directory ??= locate();
  const found = directory;
  return EXCALIDRAW_FONT_FILES.map((file) => join(found, file));
}

function locate(): string {
  const own: string | undefined = import.meta.dirname;
  const candidates = [
    join(process.cwd(), "src", "server", "drawings", "fonts"),
    ...(own ? [join(own, "fonts")] : []),
  ];
  const probe = EXCALIDRAW_FONT_FILES[0] as string;
  const found = candidates.find((candidate) =>
    existsSync(join(candidate, probe)),
  );
  if (!found) {
    throw new Error(
      `The Excalidraw fonts are not on disk; looked in ${candidates.join(" and ")}`,
    );
  }
  return found;
}
