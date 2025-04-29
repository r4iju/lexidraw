import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { experimental_generateImage as generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useToast } from "~/components/ui/toast-provider";
import {
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
} from "lexical";
import { $wrapNodeInElement } from "@lexical/utils";
import {
  ImageNode,
  ImagePayload,
} from "~/app/documents/[documentId]/nodes/ImageNode/ImageNode";
import { api } from "~/trpc/react";
import { StoredLlmConfig } from "~/server/api/routers/config";
import { v4 as uuidv4 } from "uuid"; // For generating unique filenames
import { ImageModelCallWarning } from "ai"; // Corrected import

type AllowedContentType =
  | "image/svg+xml"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif";

const ImageGenerationContext = createContext<{
  generateAndInsertImage: (prompt: string) => Promise<void>;
  generateImageData: (
    prompt: string,
    options?: { size?: "256x256" | "512x512" | "1024x1024" },
  ) => Promise<{ imageData: Uint8Array; mimeType: string } | null>;
  uploadImageData: (
    imageData: Uint8Array,
    mimeType: string,
    prompt: string,
  ) => Promise<string | null>;
  insertImageNodeFromUrl: (imageUrl: string, prompt: string) => void;
  isLoading: boolean;
  isConfigured: boolean;
} | null>(null);

export const ImageGenerationProvider = ({
  initialConfig,
  entityId,
  children,
}: {
  initialConfig: StoredLlmConfig;
  entityId: string;
  children: React.ReactNode;
}) => {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { mutateAsync: generateUploadUrlAsync } =
    api.entities.generateUploadUrl.useMutation();

  const provider = useRef(
    initialConfig.openaiApiKey
      ? createOpenAI({ apiKey: initialConfig.openaiApiKey })
      : null,
  );

  const isConfigured = !!provider.current;

  const sanitizeFilename = useCallback((name: string): string => {
    return name.replace(/[^a-z0-9_\-.]/gi, "_").substring(0, 50);
  }, []);

  const isAllowedContentType = useCallback(
    (mimeType: string): mimeType is AllowedContentType => {
      return [
        "image/svg+xml",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
      ].includes(mimeType);
    },
    [],
  );

  const generateImageData = useCallback(
    async (
      prompt: string,
      options?: {
        size?: "256x256" | "512x512" | "1024x1024";
      },
    ): Promise<{ imageData: Uint8Array; mimeType: string } | null> => {
      if (!provider.current) {
        toast({
          title: "Error",
          description: "OpenAI API key not configured.",
          variant: "destructive",
        });
        return null;
      }

      try {
        const { images, warnings } = await generateImage({
          model: provider.current.image("gpt-image-1"),
          prompt: prompt,
          n: 1,
          size: options?.size ?? "1024x1024",
        });

        if (warnings) {
          console.warn("Image generation warnings:", warnings);
          warnings.forEach((w: ImageModelCallWarning) => {
            let warningMessage = "Image generation warning";
            if (
              typeof w === "object" &&
              w !== null &&
              "setting" in w &&
              "type" in w &&
              w.type === "unsupported-setting"
            ) {
              warningMessage = `Unsupported setting: ${w.setting}${"details" in w && w.details ? ` (${w.details})` : ""}`;
            } else if (typeof w === "object" && w !== null && "message" in w) {
              warningMessage = String(w.message);
            } else {
              warningMessage = JSON.stringify(w);
            }
            toast({
              title: "Generation Warning",
              description: warningMessage,
              variant: "default",
            });
          });
        }

        const result = images[0];

        if (!result?.uint8Array) {
          throw new Error("Image generation failed, no image data returned.");
        }

        console.log("Image generated, mimeType:", result.mimeType);
        return {
          imageData: result.uint8Array,
          mimeType: result.mimeType ?? "image/png",
        };
      } catch (error) {
        console.error("Error generating image data:", error);
        const message =
          error instanceof Error
            ? error.message
            : "An unknown error occurred during generation.";
        toast({
          title: "Image Generation Failed",
          description: message,
          variant: "destructive",
        });
        return null;
      }
    },
    [toast],
  );

  // Step 2: Upload Image Data
  const uploadImageData = useCallback(
    async (
      imageData: Uint8Array,
      mimeType: string,
      prompt: string,
    ): Promise<string | null> => {
      const safePrompt = sanitizeFilename(prompt);
      const fileName = `${safePrompt}_${uuidv4()}.png`; // Use prompt for filename base + uuid

      // Ensure the mimeType is one of the allowed types for the upload endpoint
      if (!isAllowedContentType(mimeType)) {
        console.error(`Upload Error: Unsupported MIME type: ${mimeType}`);
        toast({
          title: "Upload Error",
          description: `Unsupported image type: ${mimeType}. Expected PNG, JPEG, WEBP, AVIF, or SVG.`,
          variant: "destructive",
        });
        return null;
      }

      const imageFile = new File([imageData], fileName, { type: mimeType });

      try {
        toast({
          title: "Uploading Image...",
          description: `Uploading ${fileName}`,
        });

        // Get presigned URL using correct params and result structure
        const { signedUploadUrl, signedDownloadUrl } =
          await generateUploadUrlAsync({
            entityId,
            contentType: mimeType, // Use validated contentType
            mode: "direct", // Assuming direct upload mode
          });

        // Upload the file
        const uploadResponse = await fetch(signedUploadUrl, {
          // Use signedUploadUrl
          method: "PUT",
          body: imageFile,
          headers: {
            "Content-Type": imageFile.type,
          },
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error("Upload failed response:", errorText);
          throw new Error(
            `Failed to upload image. Status: ${uploadResponse.status}`,
          );
        }

        toast({
          title: "Upload Successful",
          description: `${fileName} uploaded.`,
        });
        return signedDownloadUrl; // Return the accessible URL (signedDownloadUrl)
      } catch (error) {
        console.error("Error uploading image:", error);
        const message =
          error instanceof Error
            ? error.message
            : "An unknown error occurred during upload.";
        toast({
          title: "Image Upload Failed",
          description: message,
          variant: "destructive",
        });
        return null;
      }
    },
    [
      entityId,
      generateUploadUrlAsync,
      isAllowedContentType,
      sanitizeFilename,
      toast,
    ],
  );

  // Step 3: Insert Image Node into Editor
  const insertImageNodeFromUrl = useCallback(
    (imageUrl: string, prompt: string) => {
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

        const payload: ImagePayload = {
          src: imageUrl, // Use the final URL from upload
          altText: prompt,
        };

        const imageNode = ImageNode.$createImageNode(payload);
        $insertNodes([imageNode]);
        if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
          $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
        }
        // imageNode.setShowCaption(true); // Optionally show caption
      });
    },
    [editor, toast],
  );

  // Orchestrator: Generate, Upload, and Insert
  const generateUploadAndInsertImage = useCallback(
    async (
      prompt: string,
      options?: {
        insertAs?: "block";
        size?: "256x256" | "512x512" | "1024x1024";
      },
    ) => {
      if (!isConfigured) {
        toast({
          title: "Configuration Error",
          description: "Image generation service is not configured.",
          variant: "destructive",
        });
        return;
      }

      setIsLoading(true);
      toast({
        title: "Generating Image...",
        description: `Requesting an image for: "${prompt}"`,
      });

      try {
        // Step 1: Generate
        const generationResult = await generateImageData(prompt, options);
        if (!generationResult) {
          // Error handled within generateImageData via toast
          return;
        }
        const { imageData, mimeType } = generationResult;

        // Step 2: Upload
        const imageUrl = await uploadImageData(imageData, mimeType, prompt);
        if (!imageUrl) {
          // Error handled within uploadImageData via toast
          return;
        }

        // Step 3: Insert
        toast({
          title: "Image Ready",
          description: "Inserting image into the editor...",
        });
        insertImageNodeFromUrl(imageUrl, prompt);
      } catch (error) {
        // Catch any unexpected errors during orchestration
        console.error("Error in generation/upload/insert process:", error);
        const message =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.";
        toast({
          title: "Process Failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      isConfigured,
      generateImageData,
      uploadImageData,
      insertImageNodeFromUrl,
      toast,
    ],
  );

  return (
    <ImageGenerationContext.Provider
      value={{
        generateAndInsertImage: generateUploadAndInsertImage,
        generateImageData,
        uploadImageData,
        insertImageNodeFromUrl,
        isLoading,
        isConfigured,
      }}
    >
      {children}
    </ImageGenerationContext.Provider>
  );
};

export const useImageGeneration = () => {
  const context = useContext(ImageGenerationContext);
  if (!context) {
    throw new Error(
      "useImageGeneration must be used within a ImageGenerationProvider",
    );
  }
  return context;
};
