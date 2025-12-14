import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { api } from "~/trpc/react";
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
  entityId,
  children,
}: {
  entityId: string;
  children: ReactNode;
}) => {
  const { mutateAsync: generateUploadUrlAsync } =
    api.entities.generateUploadUrl.useMutation();
  const { data: genStatus } = api.image.getAiGenerationStatus.useQuery();
  const { mutateAsync: generateAiImage } =
    api.image.generateAiImage.useMutation();
  const [isLoading, setIsLoading] = useState(false);
  const isConfigured = !!genStatus?.isConfigured;

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
      if (!isConfigured) {
        toast.error(
          "Image generation is not available. Please configure the Image policy and API keys.",
        );
        return null;
      }
      setIsLoading(true);
      try {
        const res = await generateAiImage({
          prompt,
          size: options?.size,
        });
        // `imageBase64` is standard base64 (no data: prefix)
        const binStr = atob(res.imageBase64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        return { imageData: bytes, mimeType: res.mimeType };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown image generation error.";
        toast.error("Image generation failed", { description: message });
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [generateAiImage, isConfigured],
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
        const bytes = new Uint8Array(imageData);
        const { url } = await put(
          pathname,
          new File([bytes], fileName, { type: mimeType }),
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
  type ImagePayload,
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
