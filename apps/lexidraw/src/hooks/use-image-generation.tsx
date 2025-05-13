import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  experimental_generateImage as generateImage,
  ImageModelCallWarning,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { put } from "@vercel/blob/client";

type AllowedContentType =
  | "image/svg+xml"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif";

// ─────────────────────────────────────────────────────────────────────────────
// 1) Simple provider + hook
// ─────────────────────────────────────────────────────────────────────────────

type ImageGenerationContextValue = {
  isConfigured: boolean;
  isLoading: boolean;
  generateImageData: (
    prompt: string,
    options?: { size?: "256x256" | "512x512" | "1024x1024" },
  ) => Promise<{ imageData: Uint8Array; mimeType: string } | null>;
  uploadImageData: (
    imageData: Uint8Array,
    mimeType: string,
    prompt: string,
  ) => Promise<string | null>;
};

const ImageGenerationContext =
  createContext<ImageGenerationContextValue | null>(null);

export const ImageGenerationProvider = ({
  initialConfig,
  entityId,
  children,
}: {
  initialConfig: RouterOutputs["auth"]["getLlmConfig"];
  entityId: string;
  children: ReactNode;
}) => {
  const { mutateAsync: generateUploadUrlAsync } =
    api.entities.generateUploadUrl.useMutation();
  const [isLoading, setIsLoading] = useState(false);
  const provider = useRef(
    initialConfig?.openaiApiKey
      ? createOpenAI({ apiKey: initialConfig.openaiApiKey })
      : null,
  );
  const isConfigured = Boolean(provider.current);

  const sanitizeFilename = useCallback(
    (name: string) => name.replace(/[^a-z0-9_\-.]/gi, "_").substring(0, 50),
    [],
  );

  const isAllowedContentType = useCallback(
    (mimeType: string): mimeType is AllowedContentType =>
      [
        "image/svg+xml",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
      ].includes(mimeType),
    [],
  );

  const generateImageData = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ) => {
      if (!provider.current) {
        toast.error("API key not configured.");
        return null;
      }
      try {
        setIsLoading(true);
        const { images, warnings } = await generateImage({
          model: provider.current.image("gpt-image-1"),
          prompt,
          n: 1,
          size: options?.size ?? "1024x1024",
        });
        warnings?.forEach((w: ImageModelCallWarning) => {
          const msg =
            typeof w === "object" && "message" in w
              ? String(w.message)
              : JSON.stringify(w);
          toast.error("Generation Warning", {
            description: msg,
          });
        });
        const result = images[0];
        if (!result?.uint8Array) throw new Error("No image data returned.");
        return {
          imageData: result.uint8Array,
          mimeType: result.mimeType ?? "image/png",
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error during generation.";
        toast.error("Image Generation Failed", {
          description: message,
        });
        console.error(err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const uploadImageData = useCallback(
    async (imageData: Uint8Array, mimeType: string, prompt: string) => {
      const fileName = `${sanitizeFilename(prompt)}_${uuidv4()}.png`;
      if (!isAllowedContentType(mimeType)) {
        toast.error(`Unsupported image type: ${mimeType}`);
        return null;
      }
      try {
        toast.info("Uploading Image…", { description: fileName });
        const { token, pathname } = await generateUploadUrlAsync({
          entityId,
          contentType: mimeType,
          mode: "direct",
        });
        const { url } = await put(
          pathname,
          new File([imageData], fileName, { type: mimeType }),
          {
            access: "public",
            multipart: true,
            contentType: mimeType,
            token,
          },
        );
        toast.success("Upload Successful", { description: fileName });
        return url;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown upload error.";
        toast.error("Image Upload Failed", { description: message });
        console.error(err);
        return null;
      }
    },
    [entityId, generateUploadUrlAsync, isAllowedContentType, sanitizeFilename],
  );

  return (
    <ImageGenerationContext.Provider
      value={{ isConfigured, isLoading, generateImageData, uploadImageData }}
    >
      {children}
    </ImageGenerationContext.Provider>
  );
};

export const useImageGeneration = (): ImageGenerationContextValue => {
  const ctx = useContext(ImageGenerationContext);
  if (!ctx) {
    throw new Error(
      "useImageGeneration must be used inside ImageGenerationContext",
    );
  }
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) Lexical provider + hook (builds on the simple one)
// ─────────────────────────────────────────────────────────────────────────────

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
} from "lexical";
import {
  ImageNode,
  ImagePayload,
} from "~/app/documents/[documentId]/nodes/ImageNode/ImageNode";
import { $wrapNodeInElement } from "@lexical/utils";

type LexicalImageContextValue = {
  isLoading: boolean;
  isConfigured: boolean;
  generateAndInsertImage: (
    prompt: string,
    options?: {
      size?: "256x256" | "512x512" | "1024x1024";
    },
  ) => Promise<void>;
};

const LexicalImageContext = createContext<LexicalImageContextValue | null>(
  null,
);

export const LexicalImageGenerationProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [editor] = useLexicalComposerContext();
  const { isConfigured, generateImageData, uploadImageData } =
    useImageGeneration();
  const [isLoading, setIsLoading] = useState(false);

  const insertImageNodeFromUrl = useCallback(
    (imageUrl: string, prompt: string) => {
      editor.update(() => {
        if (!editor.hasNodes([ImageNode])) {
          toast.error("ImageNode not registered.");
          return;
        }
        const img = ImageNode.$createImageNode({
          src: imageUrl,
          altText: prompt,
        } as ImagePayload);
        $insertNodes([img]);
        if ($isRootOrShadowRoot(img.getParentOrThrow())) {
          $wrapNodeInElement(img, $createParagraphNode).selectEnd();
        }
      });
    },
    [editor],
  );

  const generateAndInsertImage = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ) => {
      if (!isConfigured) {
        toast.error("Not configured.");
        return;
      }
      setIsLoading(true);
      toast.info("Generating Image...", { description: prompt });
      try {
        const gen = await generateImageData(prompt, options);
        if (!gen) return;
        const url = await uploadImageData(gen.imageData, gen.mimeType, prompt);
        if (!url) return;
        toast.info("Inserting Image...", { description: "" });
        insertImageNodeFromUrl(url, prompt);
      } catch (err) {
        toast.error("Process Failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [isConfigured, generateImageData, uploadImageData, insertImageNodeFromUrl],
  );

  return (
    <LexicalImageContext.Provider
      value={{ isLoading, isConfigured, generateAndInsertImage }}
    >
      {children}
    </LexicalImageContext.Provider>
  );
};

export const useLexicalImageGeneration = (): LexicalImageContextValue => {
  const ctx = useContext(LexicalImageContext);
  if (!ctx) {
    throw new Error(
      "useLexicalImageGeneration must be inside LexicalImageGenerationProvider",
    );
  }
  return ctx;
};
