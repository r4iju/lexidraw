import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement } from "@lexical/utils";
import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  LexicalEditor,
  PASTE_COMMAND,
} from "lexical";
import { useEffect, useRef, useState, useCallback } from "react";
import * as React from "react";
import { ImageNode, ImagePayload } from "../../nodes/ImageNode/ImageNode";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import FileInput from "~/components/ui/file-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useUploader } from "~/hooks/use-uploader";
import { useEntityId } from "~/hooks/use-entity-id";
import { INSERT_IMAGE_COMMAND } from "./commands";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";
import { useToast } from "~/components/ui/toast-provider";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { LinkNode } from "@lexical/link";
import { useImageInsertion } from "~/hooks/use-image-insertion";
import { RouterOutputs } from "~/trpc/shared";
import { useImageGeneration } from "~/hooks/use-image-generation";
import { Textarea } from "~/components/ui/textarea";

export type InsertImagePayload = Readonly<ImagePayload>;

type UnsplashImageResult =
  RouterOutputs["image"]["searchUnsplash"]["results"][number];

export function InsertImageUriDialogBody({
  onClick,
}: {
  onClick: (payload: InsertImagePayload) => void;
}) {
  const [src, setSrc] = useState("");
  const [altText, setAltText] = useState("");

  const isDisabled = src === "";

  return (
    <>
      <Label>Image URL</Label>
      <Input
        placeholder="https://picsum.photos/200/300.jpg"
        onChange={(e) => setSrc(e.target.value)}
        value={src}
      />
      <Label>Alt Text</Label>
      <Input
        placeholder="Random unsplash image"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
      />
      <DialogFooter>
        <Button disabled={isDisabled} onClick={() => onClick({ altText, src })}>
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}

export function InsertImageUploadedDialogBody({
  onClick,
}: {
  onClick: (payload: InsertImagePayload) => void;
}) {
  const { src, handleFileChange } = useUploader();
  const entityId = useEntityId();
  const [altText, setAltText] = useState("");

  const isDisabled = src === "";

  const onChange = (files: FileList | null) => {
    handleFileChange(files, entityId);
  };

  useEffect(() => {
    console.log("InsertImageUploadedDialogBody", src);
  }, [src]);

  return (
    <>
      <FileInput label="Image Upload" onChange={onChange} accept="image/*" />
      <Label htmlFor="alt-text">Alt Text</Label>
      <Input
        placeholder="Descriptive alternative text"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
      />
      <DialogFooter>
        <Button disabled={isDisabled} onClick={() => onClick({ altText, src })}>
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}

const PER_PAGE = 9;

export function InsertImageUnsplashDialogBody({
  onImageSelect,
}: {
  onImageSelect: (image: UnsplashImageResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const { toast } = useToast();
  const searchMutation = api.image.searchUnsplash.useMutation();
  const [results, setResults] = useState<UnsplashImageResult[]>([]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 500);

    return () => {
      clearTimeout(handler);
    };
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.trim() === "") {
      setResults([]);
      setTotalPages(0);
      return;
    }

    console.log(`Searching page ${currentPage} for: ${debouncedQuery}`);
    const mutate = searchMutation.mutate;
    mutate(
      { query: debouncedQuery, page: currentPage, perPage: PER_PAGE },
      {
        onSuccess: (data) => {
          console.log("Unsplash search success:", data);
          setResults(data.results);
          setTotalPages(data.totalPages);
          if (data.results.length === 0 && currentPage === 1) {
            toast({
              title: "No Results",
              description: `No images found for "${debouncedQuery}". Try a different term.`,
            });
          }
        },
        onError: (error) => {
          console.error("Unsplash search error:", error);
          toast({
            title: "Unsplash Search Failed",
            description: error.message || "Could not fetch images.",
            variant: "destructive",
          });
          setResults([]);
          setTotalPages(0);
        },
      },
    );
  }, [debouncedQuery, currentPage, searchMutation.mutate, toast]);

  useEffect(() => {
    if (debouncedQuery.trim() !== "") {
      setCurrentPage(1);
    }
  }, [debouncedQuery]);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Input
          id="unsplash-query"
          placeholder="Search Unsplash..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-grow"
        />
      </div>

      <div className="min-h-[200px]">
        {searchMutation.isPending && (
          <div className="flex justify-center items-center h-full">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        )}
        {!searchMutation.isPending && results.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {results.map((image) => (
              <button
                key={image.id}
                onClick={() => onImageSelect(image)}
                className="aspect-square focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded overflow-hidden group"
                title={`Select image by ${image.attribution.authorName}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbUrl}
                  alt={image.altText ?? query}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        )}
        {!searchMutation.isPending &&
          results.length === 0 &&
          debouncedQuery.trim() !== "" && (
            <div className="flex justify-center items-center h-full">
              <p className="text-center text-sm text-muted-foreground">
                No results found for "{debouncedQuery}".
              </p>
            </div>
          )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || searchMutation.isPending}
            aria-label="Previous Page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages || searchMutation.isPending}
            aria-label="Next Page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );
}

export function InsertImageGeneratedDialogBody({
  onGenerate,
  isLoading,
  isConfigured,
}: {
  onGenerate: (prompt: string) => void;
  isLoading: boolean;
  isConfigured: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const isDisabled = prompt.trim() === "" || isLoading || !isConfigured;

  return (
    <>
      {!isConfigured && (
        <p className="text-center text-sm text-destructive p-4 border border-destructive rounded-md">
          Image generation service is not configured. Please set the OpenAI API
          key in the settings.
        </p>
      )}
      <Label htmlFor="image-prompt">Image Prompt</Label>
      <Textarea
        id="image-prompt"
        placeholder="e.g., A photorealistic cat wearing sunglasses"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        disabled={!isConfigured || isLoading}
      />
      <DialogFooter>
        <Button disabled={isDisabled} onClick={() => onGenerate(prompt)}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            "Generate Image"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

export function InsertImageDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<
    null | "url" | "file" | "unsplash" | "generate"
  >(null);
  const hasModifier = useRef(false);
  const { insertImageNode } = useImageInsertion();
  const trackDownloadMutation = api.image.trackUnsplashDownload.useMutation();

  const {
    generateAndInsertImage,
    isLoading: isGenerating,
    isConfigured: isGenerationConfigured,
  } = useImageGeneration();

  const handleUnsplashImageSelect = useCallback(
    (image: UnsplashImageResult) => {
      const { url, altText, attribution, downloadLocation, unsplashUrl } =
        image;
      insertImageNode({
        src: url,
        altText: altText ?? "",
        attribution: {
          authorName: attribution.authorName,
          authorUrl: attribution.authorUrl,
        },
        unsplashUrl: unsplashUrl,
      });

      // Track download separately
      trackDownloadMutation.mutate(
        { downloadLocation },
        {
          onSuccess: () =>
            console.log(`Successfully tracked download: ${downloadLocation}`),
          onError: (error: TRPCClientErrorLike<AppRouter>) =>
            console.error(
              `Failed to track download ${downloadLocation}:`,
              error,
            ),
        },
      );

      onClose();
    },
    [insertImageNode, trackDownloadMutation, onClose],
  );

  useEffect(() => {
    hasModifier.current = false;
    const handler = (e: KeyboardEvent) => {
      hasModifier.current = e.altKey;
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [activeEditor]);

  const insertImage = useCallback(
    (payload: InsertImagePayload) => {
      activeEditor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
      onClose();
    },
    [activeEditor, onClose],
  );

  const handleGenerateImage = useCallback(
    async (prompt: string) => {
      if (!prompt) return;
      await generateAndInsertImage(prompt);
      onClose();
    },
    [generateAndInsertImage, onClose],
  );

  return (
    <>
      {!mode && (
        <div className="flex flex-col gap-2">
          <Button onClick={() => setMode("url")}>URL</Button>
          <Button onClick={() => setMode("file")}>File</Button>
          <Button onClick={() => setMode("unsplash")}>Unsplash</Button>
          <Button
            onClick={() => setMode("generate")}
            disabled={!isGenerationConfigured}
            title={
              !isGenerationConfigured ? "OpenAI API key required" : undefined
            }
          >
            Generate (AI)
          </Button>
        </div>
      )}
      {mode === "url" && <InsertImageUriDialogBody onClick={insertImage} />}
      {mode === "file" && (
        <InsertImageUploadedDialogBody onClick={insertImage} />
      )}
      {mode === "unsplash" && (
        <InsertImageUnsplashDialogBody
          onImageSelect={handleUnsplashImageSelect}
        />
      )}
      {mode === "generate" && (
        <InsertImageGeneratedDialogBody
          onGenerate={handleGenerateImage}
          isLoading={isGenerating}
          isConfigured={isGenerationConfigured}
        />
      )}
    </>
  );
}

export default function ImagesPlugin({
  captionsEnabled,
}: {
  captionsEnabled?: boolean;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { toast } = useToast();
  const modalOnCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    modalOnCloseRef.current = () => setIsModalOpen(false);

    if (!editor.hasNodes([ImageNode])) {
      throw new Error("ImagesPlugin: ImageNode not registered on editor");
    }
    if (!editor.hasNodes([LinkNode])) {
      console.warn(
        "ImagesPlugin: LinkNode might not be registered on main editor. Captions with links may not work correctly.",
      );
    }

    const unregisterInsert = editor.registerCommand<InsertImagePayload>(
      INSERT_IMAGE_COMMAND,
      (payload) => {
        editor.update(() => {
          const imageNode = ImageNode.$createImageNode({
            ...payload,
            captionsEnabled,
          });
          $insertNodes([imageNode]);
          if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
            $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterPaste = editor.registerCommand<ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }
        const items = clipboardData.items;
        if (items) {
          for (const item of items) {
            if (item && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) {
                console.log("Pasted image file:", file);
                toast({
                  title: "Image Pasted",
                  description:
                    "Pasted image handling needs implementation (upload & insert).",
                });
                return true;
              }
            }
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterInsert();
      unregisterPaste();
    };
  }, [editor, captionsEnabled, toast]);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  useEffect(() => {
    modalOnCloseRef.current = closeModal;
  }, [closeModal]);

  return isModalOpen ? (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
        </DialogHeader>
        <InsertImageDialog activeEditor={editor} onClose={closeModal} />
      </DialogContent>
    </Dialog>
  ) : null;
}

const TRANSPARENT_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const img = document.createElement("img");
img.src = TRANSPARENT_IMAGE;

declare global {
  interface DragEvent {
    rangeOffset?: number;
    rangeParent?: Node;
  }
}
