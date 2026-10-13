"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { toast } from "sonner";
import {
  useImageGeneration,
  type GeneratedImageOutcome,
} from "~/hooks/use-image-generation";
import { useUnsplashImage } from "~/hooks/use-image-insertion";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { loadThumbnailSource } from "~/lib/images/thumbnail-source";
import { put } from "@vercel/blob/client";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

type Draft =
  | { kind: "existing" | "search"; url: string }
  | { kind: "file"; url: string; file: File }
  | {
      kind: "generated";
      url: string;
      result: Extract<GeneratedImageOutcome, { kind: "completed" }>;
    };

const ThumbnailModal = (props: Props) => {
  const { owner } = useImageGeneration();
  return props.isOpen ? (
    <ThumbnailDraft key={JSON.stringify([props.entity.id, owner])} {...props} />
  ) : null;
};
const ThumbnailDraft = ({ entity, isOpen, onOpenChange }: Props) => {
  const [draft, setDraft] = useState<Draft>({
    kind: "existing",
    url: entity.screenShotLight ?? "",
  });
  const intent = useRef(0);
  // The mounted modal owns its asynchronous selection lifetime.
  useLayoutEffect(
    () => () => {
      intent.current++;
    },
    [],
  );
  // Blob URLs belong to this draft preview, independently of retained image bytes.
  useEffect(
    () => () => {
      if (draft.kind === "generated" || draft.kind === "file")
        URL.revokeObjectURL(draft.url);
    },
    [draft],
  );
  const close = (open: boolean) => {
    if (!open) intent.current++;
    onOpenChange(open);
  };
  const { mutate: generateTokens } =
    api.snapshot.generateClientUploadTokens.useMutation();
  const { mutate: updateEntity } = api.entities.update.useMutation();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [generateQuery, setGenerateQuery] = useState<string>("");
  const {
    generateImageData,
    previewRetainedImage,
    saveThumbnail,
    retained,
    isLoading: isGenerating,
  } = useImageGeneration();
  const { searchImage, isLoading: isSearching } = useUnsplashImage();
  const [isUploading, setIsUploading] = useState(false);
  const router = useRouter();

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const selection = ++intent.current;
    const image = await searchImage(searchQuery);
    if (image && selection === intent.current) {
      setDraft({ kind: "search", url: image.url });
    }
  };

  const chooseGenerated = (result: GeneratedImageOutcome | null) => {
    if (!result || result.kind === "declined") return;
    if (result.kind !== "completed") {
      toast.error(result.message);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(result.imageData)], { type: result.mimeType }),
    );
    setDraft({ kind: "generated", url, result });
  };
  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    const selection = ++intent.current;
    const result = await generateImageData(generateQuery);
    if (selection === intent.current) chooseGenerated(result);
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    intent.current++;
    setDraft({ kind: "file", url, file });
  };

  /** common for all upload methods */
  const handleUpload = async () => {
    if (!draft.url) return;
    if (draft.kind === "generated") {
      const selection = intent.current;
      setIsUploading(true);
      try {
        if (!(await saveThumbnail(draft.result.identity)))
          throw Error("Thumbnail save did not confirm this retained image.");
        if (selection !== intent.current) return;
        toast.success(`Changed the thumbnail of “${entity.title}”.`);
        await revalidateDashboard();
        router.refresh();
        close(false);
      } catch {
        if (selection === intent.current)
          toast.error(
            "Thumbnail save failed. Your image is retained; retry Save without generating again.",
          );
      } finally {
        if (selection === intent.current) setIsUploading(false);
      }
      return;
    }

    let source: Awaited<ReturnType<typeof loadThumbnailSource>>;
    try {
      source = await loadThumbnailSource(draft.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn’t load that image.",
      );
      return;
    }
    const { blob, contentType } = source;

    setIsUploading(true);

    /* 1️⃣  get upload tokens (one for dark & light) */
    generateTokens(
      { entityId: entity.id, contentType },
      {
        onError: (e) => {
          toast.error("Couldn’t upload the thumbnail. Try again.", {
            description: e.message,
          });
          setIsUploading(false);
        },
        onSuccess: async (tokens) => {
          try {
            /* 2️⃣  push the file to Blob for each theme */
            const uploaded = await Promise.all(
              tokens.map(async ({ token, pathname, theme }) => {
                const { url } = await put(pathname, blob, {
                  access: "public",
                  multipart: true,
                  contentType: blob.type,
                  token,
                });
                return { theme, url };
              }),
            );

            /* 3️⃣  persist URLs in your DB */
            const light = uploaded.find((u) => u.theme === "light")?.url;
            const dark = uploaded.find((u) => u.theme === "dark")?.url;

            await new Promise<void>((resolve, reject) => {
              updateEntity(
                {
                  id: entity.id,
                  screenShotLight: light,
                  screenShotDark: dark,
                },
                {
                  onSuccess: () => resolve(),
                  onError: (e) => reject(e),
                },
              );
            });

            toast.success(`Changed the thumbnail of “${entity.title}”.`);
            await revalidateDashboard();
            router.refresh();
            close(false);
          } catch (e) {
            toast.error("Couldn’t upload the thumbnail. Try again.", {
              description: e instanceof Error ? e.message : "Unknown error",
            });
          } finally {
            setIsUploading(false);
          }
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Thumbnail</DialogTitle>
          <DialogDescription>
            Select a new thumbnail for "{entity.title}".
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 items-center justify-center w-full">
          <Tabs defaultValue="search" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="search" className="w-full">
                Search
              </TabsTrigger>
              <TabsTrigger value="generate" className="w-full">
                Generate
              </TabsTrigger>
              <TabsTrigger value="upload" className="w-full">
                Upload
              </TabsTrigger>
            </TabsList>
            <TabsContent value="search">
              <form onSubmit={handleSearch} className="w-full flex gap-2">
                <Input
                  placeholder="Search for a thumbnail"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={isSearching}
                  className="min-w-24"
                >
                  Search
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="generate">
              <form onSubmit={handleGenerate} className="w-full flex gap-2">
                <Input
                  placeholder="Generate a thumbnail"
                  value={generateQuery}
                  onChange={(e) => setGenerateQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={isGenerating}
                  className="min-w-24"
                >
                  Generate
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="upload">
              <div className="w-full flex gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleSelectFile}
                />
              </div>
            </TabsContent>
          </Tabs>
          <div className="w-full h-full flex items-center justify-center py-6">
            {isGenerating || isSearching ? (
              <Skeleton className="aspect-square w-full max-w-64" />
            ) : (
              <Image
                src={draft.url}
                unoptimized={draft.url.startsWith("/api/generated-images/")}
                alt="Thumbnail"
                width={100}
                height={100}
                className="w-full h-full object-cover max-w-64 max-h-64 rounded-md"
              />
            )}
          </div>
        </div>
        {retained && (
          <Button
            onClick={() => {
              intent.current++;
              chooseGenerated(previewRetainedImage());
            }}
          >
            Use retained image
          </Button>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={isUploading || draft.kind === "existing"}
            onClick={handleUpload}
            pending={isUploading}
          >
            Save thumbnail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ThumbnailModal;
