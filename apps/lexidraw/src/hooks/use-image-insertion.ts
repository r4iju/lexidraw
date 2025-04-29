import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $getRoot,
} from "lexical";
import { LinkNode, $createLinkNode } from "@lexical/link";
import { ImageNode } from "../app/documents/[documentId]/nodes/ImageNode/ImageNode";
import { $wrapNodeInElement } from "@lexical/utils";
import { api } from "~/trpc/react";
import { InlineImageNode } from "~/app/documents/[documentId]/nodes/InlineImageNode/InlineImageNode";
import { useToast } from "~/components/ui/toast-provider";

export const useImageInsertion = () => {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const utils = api.useUtils();
  const trackDownloadMutation = api.image.trackUnsplashDownload.useMutation();

  // Function to search and get image data
  const searchImage = useCallback(
    async (query: string) => {
      try {
        const imageData = await utils.image.imLuckyUnsplash.fetch({ query });
        if (imageData) {
          return imageData;
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
    [utils.image.imLuckyUnsplash, toast],
  );

  const insertImageNode = useCallback(
    (payload: {
      src: string;
      altText: string;
      attribution: { authorName: string; authorUrl: string };
      unsplashUrl: string;
    }) => {
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

        const captionEditor = imageNode.__caption;
        captionEditor.update(() => {
          if (!captionEditor.hasNodes([LinkNode])) {
            console.error(
              "LinkNode not registered on caption editor for ImageNode",
            );
            return;
          }

          const { authorName, authorUrl } = payload.attribution;
          const captionParagraph = $createParagraphNode();
          captionParagraph.setFormat("center");

          const photoByText = $createTextNode("Photo by ");
          const authorLink = $createLinkNode(authorUrl);
          authorLink.append($createTextNode(authorName));
          const onText = $createTextNode(" on ");
          const unsplashLink = $createLinkNode(payload.unsplashUrl);
          unsplashLink.append($createTextNode("Unsplash"));

          captionParagraph.append(
            photoByText,
            authorLink,
            onText,
            unsplashLink,
          );
          const root = $getRoot();
          root.clear();
          root.append(captionParagraph);
        });
        imageNode.setShowCaption(true);
      });
    },
    [editor, toast],
  );

  const insertInlineImageNode = useCallback(
    (payload: {
      src: string;
      altText: string;
      attribution: { authorName: string; authorUrl: string };
      unsplashUrl: string;
    }) => {
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

        const captionEditor = inlineImageNode.__caption;
        captionEditor.update(() => {
          if (!captionEditor.hasNodes([LinkNode])) {
            console.error(
              "LinkNode not registered on caption editor for InlineImageNode",
            );
            return;
          }

          const { authorName, authorUrl } = payload.attribution;
          const captionParagraph = $createParagraphNode();
          captionParagraph.setFormat("center");

          const photoByText = $createTextNode("Photo by ");
          const authorLink = $createLinkNode(authorUrl);
          authorLink.append($createTextNode(authorName));
          const onText = $createTextNode(" on ");
          const unsplashLink = $createLinkNode(payload.unsplashUrl);
          unsplashLink.append($createTextNode("Unsplash"));

          captionParagraph.append(
            photoByText,
            authorLink,
            onText,
            unsplashLink,
          );
          const root = $getRoot();
          root.clear();
          root.append(captionParagraph);
        });
        inlineImageNode.setShowCaption(true);
      });
    },
    [editor, toast],
  );

  const searchAndInsertImage = useCallback(
    async (query: string, insertAs: "block" | "inline" = "block") => {
      const imageData = await searchImage(query);
      if (!imageData) {
        return;
      }

      trackDownloadMutation.mutate(
        { downloadLocation: imageData.downloadLocation },
        {
          onSuccess: () =>
            console.log(
              `Initiated Unsplash download tracking for: ${imageData.downloadLocation}`,
            ),
          onError: (error) =>
            console.error(
              `Failed to initiate Unsplash download tracking for ${imageData.downloadLocation}:`,
              error,
            ),
        },
      );

      const insertPayload = {
        src: imageData.url,
        altText: imageData.altText,
        attribution: imageData.attribution,
        unsplashUrl: imageData.unsplashUrl,
      };

      switch (insertAs) {
        case "inline":
          insertInlineImageNode(insertPayload);
          break;
        case "block":
          insertImageNode(insertPayload);
          break;
      }
    },
    [
      searchImage,
      trackDownloadMutation,
      insertImageNode,
      insertInlineImageNode,
    ],
  );

  return {
    searchImage,
    insertImageNode,
    insertInlineImageNode,
    searchAndInsertImage,
  };
};
