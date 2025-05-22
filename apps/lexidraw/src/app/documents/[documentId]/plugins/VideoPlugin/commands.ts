import { createCommand, LexicalCommand } from "lexical";
import { VideoPayload } from "../../nodes/VideoNode/VideoNode";

export const INSERT_VIDEO_COMMAND: LexicalCommand<VideoPayload> = createCommand(
  "INSERT_VIDEO_COMMAND",
);
