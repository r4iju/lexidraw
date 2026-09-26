import { NODE_SCHEMA_URL } from "@packages/lexical-nodes/node-schema";
import { MAX_DRAWING_FILE_BYTES } from "@packages/types";
import {
  DRAWING_FILES_PATH,
  OPENAPI_PATH,
  swiftForDrawingFiles,
} from "./drawing-files";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";

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
