import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement } from "@lexical/utils";
import {
  $createParagraphNode,
  $createRangeSelection,
  $insertNodes,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { useEffect, useRef, useState, useCallback, useId } from "react";
import type * as React from "react";
import { ImageNode, type ImagePayload } from "../../nodes/ImageNode/ImageNode";
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
import { useImageUpload } from "~/hooks/use-image-upload";
import { useEntityId } from "~/hooks/use-entity-id";
import { INSERT_IMAGE_COMMAND } from "./commands";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { LinkNode } from "@lexical/link";
import { useLexicalImageInsertion } from "~/hooks/use-image-insertion";
import type { RouterOutputs } from "~/trpc/shared";
import { useLexicalImageGeneration } from "~/hooks/use-image-generation";
import { Textarea } from "~/components/ui/textarea";
import { INSERT_INLINE_IMAGE_COMMAND } from "../InlineImagePlugin";

export type InsertImagePayload = Readonly<ImagePayload>;

type UnsplashImageResult =
  RouterOutputs["image"]["searchUnsplash"]["results"][number];

function InsertImageDialogFooter({
  onCancel,
  isDisabled,
}: {
  onCancel: () => void;
  isDisabled: boolean;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isDisabled}>
        Insert image
      </Button>
    </DialogFooter>
  );
}

export function InsertImageUriDialogBody({
  onClick,
  onCancel,
}: {
  onClick: (payload: InsertImagePayload) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState("");
  const [altText, setAltText] = useState("");
  const id = useId();

  const isDisabled = src === "";

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDisabled) onClick({ altText, src });
      }}
    >
      <Label htmlFor={`${id}-src`}>Image link</Label>
      <Input
        id={`${id}-src`}
        placeholder="https://picsum.photos/200/300.jpg"
        onChange={(e) => setSrc(e.target.value)}
        value={src}
      />
      <Label htmlFor={`${id}-alt`}>Alt Text</Label>
      <Input
        id={`${id}-alt`}
        placeholder="Random unsplash image"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
      />
      <InsertImageDialogFooter onCancel={onCancel} isDisabled={isDisabled} />
    </form>
  );
}

export function InsertImageUploadedDialogBody({
  onClick,
  onCancel,
}: {
  onClick: (payload: InsertImagePayload) => void;
  onCancel: () => void;
}) {
  const upload = useImageUpload(useEntityId());
  const [src, setSrc] = useState("");
  const [altText, setAltText] = useState("");
  const altTextId = useId();

  const isDisabled = src === "";

  const onChange = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setSrc("");
    void upload(file).then((url) => url && setSrc(url));
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDisabled) onClick({ altText, src });
      }}
    >
      <FileInput label="Image Upload" onChange={onChange} accept="image/*" />
      <Label htmlFor={altTextId}>Alt Text</Label>
      <Input
        id={altTextId}
        placeholder="Descriptive alternative text"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
      />
      <InsertImageDialogFooter onCancel={onCancel} isDisabled={isDisabled} />
    </form>
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
            toast.error("No Results", {
              description: `No images found for "${debouncedQuery}". Try a different term.`,
            });
          }
        },
        onError: (error) => {
          console.error("Unsplash search error:", error);
          toast.error("Unsplash Search Failed", {
            description: error.message || "Could not fetch images.",
          });
          setResults([]);
          setTotalPages(0);
        },
      },
    );
  }, [debouncedQuery, currentPage, searchMutation.mutate]);

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

  const unsplashQueryInputId = useId();

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Input
          id={unsplashQueryInputId}
          placeholder="Search Unsplash..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="grow"
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
                type="button"
                key={image.id}
                onClick={() => onImageSelect(image)}
                className="aspect-square focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded overflow-hidden group"
                title={`Select image by ${image.attribution.authorName}`}
              >
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
  onCancel,
  isLoading,
  isConfigured,
  disabledReason,
}: {
  onGenerate: (prompt: string) => void;
  onCancel: () => void;
  isLoading: boolean;
  isConfigured: boolean;
  disabledReason?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const isDisabled = prompt.trim() === "" || isLoading || !isConfigured;
  const imagePromptTextareaId = useId();
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDisabled) onGenerate(prompt);
      }}
    >
      {!isConfigured && (
        <p className="text-center text-sm text-destructive p-4 border border-destructive rounded-md">
          Image generation is not configured.
          {disabledReason ? ` ${disabledReason}` : ""}
        </p>
      )}
      <Label htmlFor={imagePromptTextareaId}>Image Prompt</Label>
      <Textarea
        id={imagePromptTextareaId}
        placeholder="e.g., A photorealistic cat wearing sunglasses"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        disabled={!isConfigured || isLoading}
      />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isDisabled}>
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
    </form>
  );
}

export function InsertImageDialog({
  activeEditor: _activeEditor,
  onClose,
  onInsert,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
  onInsert: (payload: InsertImagePayload) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<
    null | "url" | "file" | "unsplash" | "generate"
  >(null);
  const { insertImageNode } = useLexicalImageInsertion();
  const trackDownloadMutation = api.image.trackUnsplashDownload.useMutation();

  const {
    generateAndInsertImage,
    isLoading: isGenerating,
    isConfigured: isGenerationConfigured,
  } = useLexicalImageGeneration();
  const { data: aiStatus } = api.image.getAiGenerationStatus.useQuery();

  const disabledReason =
    aiStatus && aiStatus.isConfigured === false
      ? !aiStatus.hasPolicy
        ? "Create an Image policy in Admin → LLM → Policies (Image) and click Save."
        : aiStatus.policy?.provider === "google" && !aiStatus.hasGoogleApiKey
          ? "Missing GOOGLE_API_KEY."
          : aiStatus.policy?.provider === "openai" && !aiStatus.hasOpenAiApiKey
            ? "Missing OPENAI_API_KEY."
            : "Check Image policy provider/modelId and allowedModels."
      : undefined;

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
          <Button onClick={() => setMode("url")}>Link</Button>
          <Button onClick={() => setMode("file")}>File</Button>
          <Button onClick={() => setMode("unsplash")}>Unsplash</Button>
          <Button
            onClick={() => setMode("generate")}
            disabled={!isGenerationConfigured}
            title={
              !isGenerationConfigured
                ? (disabledReason ?? "Image generation not configured")
                : undefined
            }
          >
            Generate (AI)
          </Button>
        </div>
      )}
      {mode === "url" && (
        <InsertImageUriDialogBody onClick={onInsert} onCancel={onClose} />
      )}
      {mode === "file" && (
        <InsertImageUploadedDialogBody onClick={onInsert} onCancel={onClose} />
      )}
      {mode === "unsplash" && (
        <InsertImageUnsplashDialogBody
          onImageSelect={handleUnsplashImageSelect}
        />
      )}
      {mode === "generate" && (
        <InsertImageGeneratedDialogBody
          onGenerate={handleGenerateImage}
          onCancel={onClose}
          isLoading={isGenerating}
          isConfigured={isGenerationConfigured}
          disabledReason={disabledReason}
        />
      )}
    </>
  );
}

export default function ImagePlugin({
  captionsEnabled,
}: {
  captionsEnabled?: boolean;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const modalOnCloseRef = useRef<(() => void) | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const uploadImage = useImageUpload(useEntityId());

  const handleInsertByCommand = useCallback(
    (payload: InsertImagePayload) => {
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
      setIsModalOpen(false);
    },
    [editor],
  );

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

    const getDropRange = (event: DragEvent): Range | null | undefined => {
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(event.clientX, event.clientY);
      }
      const sel = window?.getSelection?.() || null;
      if (event.rangeParent && sel) {
        sel.collapse(event.rangeParent, event.rangeOffset || 0);
        return sel.getRangeAt(0);
      }
      return null;
    };

    const unregisterDragOver = editor.registerCommand<DragEvent>(
      DRAGOVER_COMMAND,
      (event) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const items = Array.from(dt.items || []);
        const hasImage = items.some((i) => i.type?.startsWith("image/"));
        if (hasImage) {
          event.preventDefault();
          dt.dropEffect = "copy";
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterDrop = editor.registerCommand<DragEvent>(
      DROP_COMMAND,
      (event) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const files = Array.from(dt.files || []) as File[];
        const imageFiles = files.filter((f) => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        const range = getDropRange(event);
        const rangeSelection = $createRangeSelection();
        if (range) rangeSelection.applyDOMRange(range);
        $setSelection(rangeSelection);

        void (async () => {
          for (const file of imageFiles) {
            try {
              const url = await uploadImage(file);
              if (!url) continue;
              const altText = (file.name || "image").replace(/\.[^/.]+$/, "");
              editor.dispatchCommand(INSERT_INLINE_IMAGE_COMMAND, {
                src: url,
                altText,
                position: "left",
                showCaption: false,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              toast.error("Upload failed", { description: msg });
            }
          }
          toast.success(
            imageFiles.length > 1
              ? `Inserted ${imageFiles.length} images`
              : "Image inserted",
          );
        })();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
          return false;
        }
        const items = clipboardData.items;
        if (!items || items.length === 0) {
          return false;
        }
        for (const item of items) {
          if (item?.type?.startsWith("image/")) {
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            toast.info("Uploading image…");
            void (async () => {
              try {
                const url = await uploadImage(file);
                if (!url) return;
                const altText = (file.name || "image").replace(/\.[^/.]+$/, "");
                editor.dispatchCommand(INSERT_INLINE_IMAGE_COMMAND, {
                  src: url,
                  altText,
                  position: "left",
                  showCaption: false,
                });
                toast.success("Image inserted");
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : "Unknown error";
                toast.error("Upload failed", { description: msg });
              }
            })();
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterInsert();
      unregisterDragOver();
      unregisterDrop();
      unregisterPaste();
    };
  }, [editor, captionsEnabled, uploadImage]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  useEffect(() => {
    modalOnCloseRef.current = closeModal;
  }, [closeModal]);

  return isModalOpen ? (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
        </DialogHeader>
        <InsertImageDialog
          activeEditor={editor}
          onClose={closeModal}
          onInsert={handleInsertByCommand}
        />
      </DialogContent>
    </Dialog>
  ) : null;
}

declare global {
  interface DragEvent {
    rangeOffset?: number;
    rangeParent?: Node;
  }
}
