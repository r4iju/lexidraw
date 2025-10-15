import { createCommand, type LexicalCommand } from "lexical";
import type { VideoPayload } from "../../nodes/VideoNode/VideoNode";

export const INSERT_VIDEO_COMMAND: LexicalCommand<VideoPayload> = createCommand(
  "INSERT_VIDEO_COMMAND",
);
