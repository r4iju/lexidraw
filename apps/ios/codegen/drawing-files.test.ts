import { expect, test } from "bun:test";
import { MAX_DRAWING_FILE_BYTES } from "@packages/types";
import {
  DRAWING_FILES_PATH,
  OPENAPI_PATH,
  swiftForDrawingFiles,
} from "./drawing-files";

test("the committed drawing-file types and limit are a fresh codegen of the server's", async () => {
  const openapi = await Bun.file(OPENAPI_PATH).json();
  const committed = await Bun.file(DRAWING_FILES_PATH).text();
  expect(committed).toBe(swiftForDrawingFiles(openapi, MAX_DRAWING_FILE_BYTES));
});
