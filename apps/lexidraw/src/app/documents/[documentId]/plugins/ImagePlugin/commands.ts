import { createCommand, type LexicalCommand } from "lexical";
import type { ImagePayload } from "../../nodes/ImageNode/ImageNode";

export const INSERT_IMAGE_COMMAND: LexicalCommand<ImagePayload> = createCommand(
  "INSERT_IMAGE_COMMAND",
);
