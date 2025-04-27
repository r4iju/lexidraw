import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
} from "lexical";
import { ImageNode } from "../app/documents/[documentId]/nodes/ImageNode"; // Adjust path as needed

import { $wrapNodeInElement } from "@lexical/utils";
import { api } from "~/trpc/react";
import { InlineImageNode } from "~/app/documents/[documentId]/nodes/InlineImageNode/InlineImageNode";
import { useToast } from "~/components/ui/toast-provider";

interface ImageInsertionResult {
  id: string;
  url: string;
  altText: string;
  attribution?: {
    authorName: string;
    authorUrl: string;
  };
}

export const useImageInsertion = () => {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const utils = api.useUtils();

  // Function to search and get image data
  const searchImage = useCallback(
    async (query: string): Promise<ImageInsertionResult | null> => {
      try {
        const imageData = await utils.image.searchUnsplash.fetch({ query });
        if (imageData) {
          return imageData; // Contains id, url, altText, attribution
        } else {
          toast({
            title: "Image Search Failed",
            description: `Could not find an image for "${query}".`,
            variant: "destructive",
          });
          return null;
        }
      } catch (error) {
        console.error("Error searching image:", error);
        const message =
          error instanceof Error ? error.message : "An unknown error occurred.";
        toast({
          title: "Image Search Error",
          description: message,
          variant: "destructive",
        });
        return null;
      }
    },
    [utils.image.searchUnsplash, toast],
  );

  // Function to insert a regular ImageNode
  const insertImageNode = useCallback(
    (payload: { src: string; altText: string }) => {
      editor.update(() => {
        if (!editor.hasNodes([ImageNode])) {
          console.error("ImageNode not registered on editor");
          toast({
            title: "Error",
            description: "ImageNode not registered.",
            variant: "destructive",
          });
          return;
        }
        const imageNode = ImageNode.$createImageNode(payload);
        $insertNodes([imageNode]);
        if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
          $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
        }
      });
    },
    [editor, toast],
  );

  // Function to insert an InlineImageNode
  const insertInlineImageNode = useCallback(
    (payload: { src: string; altText: string }) => {
      editor.update(() => {
        if (!editor.hasNodes([InlineImageNode])) {
          console.error("InlineImageNode not registered on editor");
          toast({
            title: "Error",
            description: "InlineImageNode not registered.",
            variant: "destructive",
          });
          return;
        }
        const inlineImageNode = InlineImageNode.$createInlineImageNode(payload);
        $insertNodes([inlineImageNode]);
      });
    },
    [editor, toast],
  );

  // Combined function: search then insert (defaulting to regular image)
  const searchAndInsertImage = useCallback(
    async (query: string, insertAs: "block" | "inline" = "block") => {
      const imageData = await searchImage(query);
      if (imageData) {
        const payload = { src: imageData.url, altText: imageData.altText };
        if (insertAs === "inline") {
          insertInlineImageNode(payload);
        } else {
          insertImageNode(payload);
        }
      }
    },
    [searchImage, insertImageNode, insertInlineImageNode],
  );

  return {
    searchImage,
    insertImageNode,
    insertInlineImageNode,
    searchAndInsertImage,
  };
};
