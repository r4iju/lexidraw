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

const { DOCUMENT_SETTINGS_PATH, swiftForDocumentSettings } = await import("./document-fonts");
await Bun.write(DOCUMENT_SETTINGS_PATH, await swiftForDocumentSettings());
