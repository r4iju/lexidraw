"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
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
import { useImageGeneration } from "~/hooks/use-image-generation";
import { useUnsplashImage } from "~/hooks/use-image-insertion";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { ReloadIcon } from "@radix-ui/react-icons";
import { put } from "@vercel/blob/client";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const ThumbnailModal = ({ entity, isOpen, onOpenChange }: Props) => {
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(
    entity.screenShotLight ?? null,
  );
  const { mutate: generateTokens } =
    api.snapshot.generateClientUploadTokens.useMutation();
  const { mutate: updateEntity } = api.entities.update.useMutation();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [generateQuery, setGenerateQuery] = useState<string>("");
  const { generateImageData, isLoading: isGenerating } = useImageGeneration();
  const { searchImage, isLoading: isSearching } = useUnsplashImage();
  const [isUploading, setIsUploading] = useState(false);
  const isLoading = isGenerating || isSearching || isUploading;
  const router = useRouter();

  const handleSearch = async () => {
    const image = await searchImage(searchQuery);
    if (image) {
      setSelectedThumbnail(image.url);
    }
  };

  const handleGenerate = async () => {
    const image = await generateImageData(generateQuery);
    if (!image) {
      toast.error("Failed to generate image");
      return;
    }
    // create a blob from the image data
    const blob = new Blob([image.imageData], { type: image.mimeType });
    // create a url from the blob
    const url = URL.createObjectURL(blob);
    // set the selected thumbnail to the url
    setSelectedThumbnail(url);
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    setSelectedThumbnail(url);
  };

  const allowedTypes = [
    "image/svg+xml",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
  ] as const;
  type AllowedContentType = (typeof allowedTypes)[number];

  /** common for all upload methods */
  const handleUpload = async () => {
    if (!selectedThumbnail) return;

    const res = await fetch(selectedThumbnail);
    if (!res.ok) {
      toast.error("Failed to fetch image for upload");
      return;
    }
    const blob = await res.blob();

    if (!allowedTypes.includes(blob.type as AllowedContentType)) {
      toast.error("Invalid Image Type", {
        description: `Unsupported type: ${blob.type || "unknown"}`,
      });
      return;
    }

    setIsUploading(true);

    /* 1️⃣  get upload tokens (one for dark & light) */
    generateTokens(
      { entityId: entity.id, contentType: blob.type as AllowedContentType },
      {
        onError: (e) => {
          toast.error("Unable to prepare upload", { description: e.message });
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
                  onSuccess: resolve,
                  onError: (e) => reject(e),
                },
              );
            });

            toast.success("Thumbnail saved");
            await revalidateDashboard();
            router.refresh();
            onOpenChange(false);
          } catch (e) {
            console.error("Error uploading thumbnail in icon-modal.tsx", e);
            toast.error("Upload failed", { description: (e as Error).message });
          } finally {
            setIsUploading(false);
          }
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-96 max-w-lg">
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
              <div className="w-full flex gap-2">
                <Input
                  placeholder="Search for a thumbnail"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="min-w-24"
                >
                  Search
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="generate">
              <div className="w-full flex gap-2">
                <Input
                  placeholder="Generate a thumbnail"
                  value={generateQuery}
                  onChange={(e) => setGenerateQuery(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="min-w-24"
                >
                  Generate
                </Button>
              </div>
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
            <Image
              src={selectedThumbnail ?? ""}
              alt="Thumbnail"
              width={100}
              height={100}
              className={cn(
                "w-full h-full object-cover max-w-64 max-h-64 rounded-md",
                {
                  "animate-pulse": isLoading,
                },
              )}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            disabled={
              isUploading || selectedThumbnail === entity.screenShotLight
            }
            onClick={handleUpload}
            className="flex items-center gap-2"
          >
            <ReloadIcon
              className={cn("w-0", isUploading && "animate-spin w-4")}
            />
            <span>Save thumbnail</span>
            <ReloadIcon className="w-0 opacity-0" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ThumbnailModal;
