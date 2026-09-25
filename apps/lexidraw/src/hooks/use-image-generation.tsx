import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { uploadGeneratedImage } from "~/lib/media-upload";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useImageUpload } from "~/hooks/use-media-upload";

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
  signedIn,
  children,
}: {
  entityId: string;
  /** Generating an image needs an account; a visitor is never offered it. */
  signedIn: boolean;
  children: ReactNode;
}) => {
  const uploadImage = useImageUpload(entityId);
  const { data: genStatus } = api.image.getAiGenerationStatus.useQuery(
    undefined,
    { enabled: signedIn },
  );
  const { mutateAsync: generateAiImage } =
    api.image.generateAiImage.useMutation();
  const [isLoading, setIsLoading] = useState(false);
  const isConfigured = !!genStatus?.isConfigured;

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
    (imageData: Uint8Array, mimeType: string, prompt: string) =>
      uploadGeneratedImage(imageData, mimeType, prompt, uploadImage),
    [uploadImage],
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
