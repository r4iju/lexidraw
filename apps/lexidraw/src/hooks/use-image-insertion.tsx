import React, {
  createContext,
  useContext,
  useCallback,
  ReactNode,
  useState,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $getRoot,
} from "lexical";
import { LinkNode, $createLinkNode } from "@lexical/link";
import { $wrapNodeInElement } from "@lexical/utils";
import { ImageNode } from "~/app/documents/[documentId]/nodes/ImageNode/ImageNode";
import { InlineImageNode } from "~/app/documents/[documentId]/nodes/InlineImageNode/InlineImageNode";
import { api } from "~/trpc/react";
import { useToast } from "~/components/ui/toast-provider";

/**
 * Types for Unsplash image data returned from the API
 */
type UnsplashImageData = {
  url: string;
  altText: string;
  attribution: { authorName: string; authorUrl: string };
  unsplashUrl: string;
  downloadLocation: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) Simple image search/tracking context + hook
// ─────────────────────────────────────────────────────────────────────────────

type ImageContextValue = {
  isLoading: boolean;
  searchImage: (query: string) => Promise<UnsplashImageData | null>;
  trackDownload: (downloadLocation: string) => void;
};

const ImageContext = createContext<ImageContextValue | null>(null);

export const ImageProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const utils = api.useUtils();
  const trackDownloadMutation = api.image.trackUnsplashDownload.useMutation();
  const [isLoading, setIsLoading] = useState(false);
  const searchImage = useCallback(
    async (query: string) => {
      try {
        setIsLoading(true);
        const imageData = await utils.image.imLuckyUnsplash.fetch({ query });
        if (!imageData) {
          toast({
            title: "Image Search Failed",
            description: `Could not find an image for "${query}".`,
            variant: "destructive",
          });
          return null;
        }
        return imageData;
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
      } finally {
        setIsLoading(false);
      }
    },
    [utils.image.imLuckyUnsplash, toast],
  );

  const trackDownload = useCallback(
    (downloadLocation: string) => {
      trackDownloadMutation.mutate(
        { downloadLocation },
        {
          onSuccess: () =>
            console.log(`Tracked Unsplash download for: ${downloadLocation}`),
          onError: (error) =>
            console.error(
              `Failed to track download for ${downloadLocation}:`,
              error,
            ),
        },
      );
    },
    [trackDownloadMutation],
  );

  return (
    <ImageContext.Provider value={{ searchImage, trackDownload, isLoading }}>
      {children}
    </ImageContext.Provider>
  );
};

export const useUnsplashImage = (): ImageContextValue => {
  const ctx = useContext(ImageContext);
  if (!ctx) {
    throw new Error("useUnsplashImage must be used within an ImageProvider");
  }
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) Lexical image insertion context + hook
// ─────────────────────────────────────────────────────────────────────────────

type LexicalImageContextValue = {
  insertImageNode: (payload: {
    src: string;
    altText: string;
    attribution: { authorName: string; authorUrl: string };
    unsplashUrl: string;
  }) => void;
  insertInlineImageNode: (payload: {
    src: string;
    altText: string;
    attribution: { authorName: string; authorUrl: string };
    unsplashUrl: string;
  }) => void;
  searchAndInsertImage: (
    query: string,
    insertAs: "block" | "inline",
  ) => Promise<void>;
};

const LexicalImageContext = createContext<LexicalImageContextValue | null>(
  null,
);

export const LexicalImageProvider = ({ children }: { children: ReactNode }) => {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const { searchImage, trackDownload } = useUnsplashImage();

  const insertImageNode = useCallback(
    (payload: {
      src: string;
      altText: string;
      attribution: { authorName: string; authorUrl: string };
      unsplashUrl: string;
    }) => {
      editor.update(() => {
        if (!editor.hasNodes([ImageNode])) {
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

        // Caption with attribution
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
          toast({
            title: "Error",
            description: "InlineImageNode not registered.",
            variant: "destructive",
          });
          return;
        }
        const inlineNode = InlineImageNode.$createInlineImageNode(payload);
        $insertNodes([inlineNode]);

        // Inline caption with attribution
        const captionEditor = inlineNode.__caption;
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
        inlineNode.setShowCaption(true);
      });
    },
    [editor, toast],
  );

  const searchAndInsertImage = useCallback(
    async (query: string, insertAs: "block" | "inline" = "block") => {
      const data = await searchImage(query);
      if (!data) return;
      trackDownload(data.downloadLocation);

      const payload = {
        src: data.url,
        altText: data.altText,
        attribution: data.attribution,
        unsplashUrl: data.unsplashUrl,
      };

      if (insertAs === "inline") {
        insertInlineImageNode(payload);
      } else {
        insertImageNode(payload);
      }
    },
    [searchImage, trackDownload, insertImageNode, insertInlineImageNode],
  );

  return (
    <LexicalImageContext.Provider
      value={{ insertImageNode, insertInlineImageNode, searchAndInsertImage }}
    >
      {children}
    </LexicalImageContext.Provider>
  );
};

export const useLexicalImageInsertion = (): LexicalImageContextValue => {
  const ctx = useContext(LexicalImageContext);
  if (!ctx) {
    throw new Error(
      "useLexicalImageInsertion must be used within LexicalImageProvider",
    );
  }
  return ctx;
};
