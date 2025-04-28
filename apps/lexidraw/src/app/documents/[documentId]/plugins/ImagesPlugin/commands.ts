import { createCommand, LexicalCommand } from "lexical";
import { ImagePayload } from "../../nodes/ImageNode";

interface UnsplashImagePayload {
  id: string;
  url: string;
  thumbUrl: string;
  altText: string | null;
  downloadLocation: string;
}

export const INSERT_IMAGE_COMMAND: LexicalCommand<ImagePayload> = createCommand(
  "INSERT_IMAGE_COMMAND",
);

export const SEARCH_INSERT_UNSPLASH_IMAGE_COMMAND: LexicalCommand<UnsplashImagePayload> =
  createCommand("SEARCH_INSERT_UNSPLASH_IMAGE_COMMAND");
