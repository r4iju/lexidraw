import { NODE_SCHEMA_URL } from "@packages/lexical-nodes/node-schema";
import { createTransformers } from "@packages/lexical-nodes/transformers";
import { MAX_DRAWING_FILE_BYTES } from "@packages/types";
import {
  DRAWING_FILES_PATH,
  OPENAPI_PATH,
  swiftForDrawingFiles,
} from "./drawing-files";
import {
  LINK_PROTOCOLS_PATH,
  LINKS_PATH,
  swiftForLinkProtocols,
  swiftForLinks,
} from "./links";
import {
  MARKDOWN_PATTERNS,
  MARKDOWN_TRANSFORMERS_PATH,
  swiftForMarkdownTransformers,
} from "./markdown";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";
import { SHORTCUTS_PATH, swiftForShortcuts } from "./shortcuts";
import {
  FOOTNOTE_STYLE_PATH, swiftForFootnoteStyle,
  EMOJI_ALIASES_PATH,
  SOCIAL_STYLE_PATH,
  swiftForSocialStyle,
  POLL_STYLE_PATH,
  swiftForEmojiAliases,
  swiftForPollStyle,
} from "./social";
import {
  DOCUMENT_TYPOGRAPHY_PATH,
  readWebStyles,
  swiftForTypography,
} from "./typography";

await Bun.write(
  SERIALIZED_NODES_PATH,
  swiftForNodeSchema(await Bun.file(NODE_SCHEMA_URL).json()),
);
await Bun.write(
  DRAWING_FILES_PATH,
  swiftForDrawingFiles(
    await Bun.file(OPENAPI_PATH).json(),
    MAX_DRAWING_FILE_BYTES,
  ),
);
await Bun.write(
  MARKDOWN_TRANSFORMERS_PATH,
  swiftForMarkdownTransformers(createTransformers(), MARKDOWN_PATTERNS),
);
await Bun.write(
  DOCUMENT_TYPOGRAPHY_PATH,
  swiftForTypography(await readWebStyles()),
);
await Bun.write(LINKS_PATH, await swiftForLinks());
await Bun.write(LINK_PROTOCOLS_PATH, swiftForLinkProtocols());
await Bun.write(SHORTCUTS_PATH, swiftForShortcuts());
await Bun.write(EMOJI_ALIASES_PATH, swiftForEmojiAliases());
await Bun.write(POLL_STYLE_PATH, await swiftForPollStyle());

const { HTML_IMPORT_PATH, swiftForHTMLImport } = await import("./html");
await Bun.write(HTML_IMPORT_PATH, await swiftForHTMLImport());

const { EMBEDDED_DRAWING_STYLE_PATH, swiftForEmbeddedDrawingStyle } =
  await import("./embedded-drawing");
await Bun.write(
  EMBEDDED_DRAWING_STYLE_PATH,
  await swiftForEmbeddedDrawingStyle(),
);

const { FIGURE_STYLE_PATH, swiftForFigureStyle } = await import(
  "./embedded-drawing"
);
await Bun.write(FIGURE_STYLE_PATH, await swiftForFigureStyle());

const { DOCUMENT_SETTINGS_PATH, swiftForDocumentSettings } = await import(
  "./document-fonts"
);
await Bun.write(DOCUMENT_SETTINGS_PATH, await swiftForDocumentSettings());

const { fontSizing } = await import("./font-sizing");
const sizing = fontSizing();
await Bun.write(
  new URL("../Sources/LexidrawJSON/WebFontSizing.swift", import.meta.url),
  sizing.swift,
);
await Bun.write(
  new URL("../reference/font-sizing.ts", import.meta.url),
  sizing.reference,
);

const { referenceClearFormatting } = await import("./clear-formatting");
await Bun.write(
  new URL("../reference/clear-formatting.ts", import.meta.url),
  referenceClearFormatting(),
);

const { fileURLToPath } = await import("node:url");
const formatting = Bun.spawn({
  cmd: [
    process.execPath,
    "x",
    "@biomejs/biome",
    "format",
    "--write",
    fileURLToPath(new URL("../reference/font-sizing.ts", import.meta.url)),
    fileURLToPath(new URL("../reference/clear-formatting.ts", import.meta.url)),
  ],
  stdout: "ignore",
  stderr: "inherit",
});
if ((await formatting.exited) !== 0)
  throw new Error("Reference helper formatting failed");
const { MEDIA_LINKS_PATH, swiftForMediaLinks } = await import("./media");
await Bun.write(MEDIA_LINKS_PATH, swiftForMediaLinks());
const { MEDIA_STYLE_PATH, swiftForMediaStyle } = await import("./media");
await Bun.write(MEDIA_STYLE_PATH, await swiftForMediaStyle());

const { MEDIA_IMAGES_PATH, swiftForMediaImages } = await import("./media");
await Bun.write(MEDIA_IMAGES_PATH, swiftForMediaImages());
const { RENDERED_EMBED_STYLE_PATH, swiftForRenderedEmbedStyle } = await import(
  "./rendered-embeds"
);
await Bun.write(RENDERED_EMBED_STYLE_PATH, await swiftForRenderedEmbedStyle());

await Bun.write(SOCIAL_STYLE_PATH, await swiftForSocialStyle());

await Bun.write(FOOTNOTE_STYLE_PATH, await swiftForFootnoteStyle());

const { STRUCTURAL_BLOCKS_PATH, swiftForStructuralBlocks } = await import(
  "./structural-blocks"
);
await Bun.write(STRUCTURAL_BLOCKS_PATH, await swiftForStructuralBlocks());
