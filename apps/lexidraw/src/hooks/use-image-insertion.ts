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
import { ImageNode } from "../app/documents/[documentId]/nodes/ImageNode";
import { $wrapNodeInElement } from "@lexical/utils";
import { api } from "~/trpc/react";
import { InlineImageNode } from "~/app/documents/[documentId]/nodes/InlineImageNode/InlineImageNode";
import { useToast } from "~/components/ui/toast-provider";

interface ImageInsertionResult {
  id: string;
  url: string;
  altText: string;
  downloadLocation: string;
  attribution?: {
    authorName: string;
    authorUrl: string;
  };
}

export const useImageInsertion = () => {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const utils = api.useUtils();
  const trackDownloadMutation = api.image.trackUnsplashDownload.useMutation();

  // Function to search and get image data
  const searchImage = useCallback(
    async (query: string): Promise<ImageInsertionResult | null> => {
      try {
        const imageData = await utils.image.imLuckyUnsplash.fetch({ query });
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
    [utils.image.imLuckyUnsplash, toast],
  );

  // Function to insert a regular ImageNode
  const insertImageNode = useCallback(
    (payload: {
      src: string;
      altText: string;
      attribution?: { authorName: string; authorUrl: string };
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
      });
    },
    [editor, toast],
  );

  // Function to insert an InlineImageNode
  const insertInlineImageNode = useCallback(
    (payload: {
      src: string;
      altText: string;
      attribution?: { authorName: string; authorUrl: string };
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

        // Insert caption if attribution exists
        if (payload.attribution) {
          const captionEditor = inlineImageNode.__caption; // Access internal editor
          captionEditor.update(() => {
            if (!captionEditor.hasNodes([LinkNode])) {
              console.error("LinkNode not registered on caption editor");
              // Ideally, register LinkNode when creating the caption editor
              // For now, we'll skip caption insertion if not registered
              return;
            }
            const { authorName, authorUrl } = payload.attribution ?? {};
            const unsplashUrl = "https://unsplash.com";

            const captionParagraph = $createParagraphNode();
            captionParagraph.setFormat("center");

            const photoByText = $createTextNode("Photo by ");
            const authorLink = $createLinkNode(authorUrl);
            authorLink.append($createTextNode(authorName));
            const onText = $createTextNode(" on ");
            const unsplashLink = $createLinkNode(unsplashUrl);
            unsplashLink.append($createTextNode("Unsplash"));

            captionParagraph.append(
              photoByText,
              authorLink,
              onText,
              unsplashLink,
            );
            const root = $getRoot();
            root.append(captionParagraph);
          });
          inlineImageNode.setShowCaption(true); // Make sure caption is visible
        }
      });
    },
    [editor, toast],
  );

  // Combined function: search then insert (defaulting to regular image)
  const searchAndInsertImage = useCallback(
    async (query: string, insertAs: "block" | "inline" = "block") => {
      // 1. Fetch image data asynchronously first
      const imageData = await searchImage(query);

      // 2. If fetch failed, exit early
      if (!imageData) {
        return;
      }

      // 3. Trigger Unsplash download tracking
      try {
        // Call the mutation using the hook
        trackDownloadMutation.mutate({
          downloadLocation: imageData.downloadLocation,
        });
        console.log(
          "Initiated Unsplash download tracking for:",
          imageData.downloadLocation,
        );
      } catch (error) {
        console.error("Failed to initiate Unsplash download tracking:", error);
        // Decide if this failure should prevent image insertion or just be logged.
      }

      // 3. Perform synchronous editor updates
      editor.update(() => {
        const payload = { src: imageData.url, altText: imageData.altText };

        if (insertAs === "inline") {
          if (!editor.hasNodes([InlineImageNode, LinkNode])) {
            console.error(
              "InlineImageNode or LinkNode not registered on main editor",
            );
            toast({
              title: "Error",
              description: "InlineImageNode or LinkNode not registered.",
              variant: "destructive",
            });
            return;
          }
          const inlineImageNode =
            InlineImageNode.$createInlineImageNode(payload);
          $insertNodes([inlineImageNode]);

          // Insert caption if attribution exists
          if (imageData.attribution) {
            const captionEditor = inlineImageNode.__caption; // Access internal editor
            captionEditor.update(() => {
              if (!imageData.attribution) return;

              if (!captionEditor.hasNodes([LinkNode])) {
                console.error("LinkNode not registered on caption editor");
                // Ideally, register LinkNode when creating the caption editor
                // For now, we'll skip caption insertion if not registered
                return;
              }
              const { authorName, authorUrl } = imageData.attribution;
              const unsplashUrl = "https://unsplash.com";

              const captionParagraph = $createParagraphNode();
              captionParagraph.setFormat("center");

              const photoByText = $createTextNode("Photo by ");
              const authorLink = $createLinkNode(authorUrl);
              authorLink.append($createTextNode(authorName));
              const onText = $createTextNode(" on ");
              const unsplashLink = $createLinkNode(unsplashUrl);
              unsplashLink.append($createTextNode("Unsplash"));

              captionParagraph.append(
                photoByText,
                authorLink,
                onText,
                unsplashLink,
              );
              const root = $getRoot();
              root.append(captionParagraph);
            });
            inlineImageNode.setShowCaption(true); // Make sure caption is visible
          }
        } else {
          // Ensure both ImageNode and LinkNode are registered on the main editor
          if (!editor.hasNodes([ImageNode, LinkNode])) {
            console.error(
              "ImageNode or LinkNode not registered on main editor",
            );
            toast({
              title: "Error",
              description: "ImageNode or LinkNode not registered.",
              variant: "destructive",
            });
            return;
          }
          const imageNode = ImageNode.$createImageNode(payload);
          $insertNodes([imageNode]);

          // Insert caption if attribution exists
          if (imageData.attribution) {
            const captionEditor = imageNode.__caption; // Access internal editor
            captionEditor.update(() => {
              // Check attribution again inside update for type safety
              if (!imageData.attribution) return;

              // Ensure LinkNode is registered on the caption editor
              if (!captionEditor.hasNodes([LinkNode])) {
                console.error(
                  "LinkNode not registered on caption editor for ImageNode",
                );
                // TODO: Potentially register LinkNode when creating the caption editor in ImageNode.tsx
                return; // Skip caption if LinkNode unavailable
              }

              const { authorName, authorUrl } = imageData.attribution; // Already checked, but safe
              const unsplashUrl = "https://unsplash.com";

              const captionParagraph = $createParagraphNode();
              captionParagraph.setFormat("center");

              const photoByText = $createTextNode("Photo by ");
              const authorLink = $createLinkNode(authorUrl);
              authorLink.append($createTextNode(authorName));
              const onText = $createTextNode(" on ");
              const unsplashLink = $createLinkNode(unsplashUrl);
              unsplashLink.append($createTextNode("Unsplash"));

              captionParagraph.append(
                photoByText,
                authorLink,
                onText,
                unsplashLink,
              );

              // Append the paragraph to the root of the caption editor
              const root = $getRoot(); // Use $getRoot within caption editor's update
              root.append(captionParagraph);
            });
            imageNode.setShowCaption(true); // Make sure caption is visible
          }
        }
      });
    },
    [editor, searchImage, toast, trackDownloadMutation],
  );

  return {
    searchImage,
    insertImageNode,
    insertInlineImageNode,
    searchAndInsertImage,
  };
};
