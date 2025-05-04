"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
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
import { useToast } from "~/components/ui/toast-provider";
import { useImageGeneration } from "~/hooks/use-image-generation";
import { useUnsplashImage } from "~/hooks/use-image-insertion";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { ReloadIcon } from "@radix-ui/react-icons";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const ThumbnailModal = ({ entity, isOpen, onOpenChange }: Props) => {
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(
    entity.screenShotLight ?? null,
  );
  const { mutate: generateUploadUrls } =
    api.snapshot.generateUploadUrls.useMutation();
  const { mutate: updateEntity } = api.entities.update.useMutation();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [generateQuery, setGenerateQuery] = useState<string>("");
  const { generateImageData, isLoading: isGenerating } = useImageGeneration();
  const { searchImage, isLoading: isSearching } = useUnsplashImage();
  const [isUploading, setIsUploading] = useState(false);
  const isLoading = isGenerating || isSearching || isUploading;
  const router = useRouter();

  const { toast } = useToast();

  const handleSearch = async () => {
    const image = await searchImage(searchQuery);
    if (image) {
      setSelectedThumbnail(image.url);
    }
  };

  const handleGenerate = async () => {
    const image = await generateImageData(generateQuery);
    if (!image) {
      toast({
        title: "Error",
        description: "Failed to generate image",
      });
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
    if (!selectedThumbnail) {
      return;
    }
    // Fetch the image data from the URL
    const response = await fetch(selectedThumbnail);
    if (!response.ok) {
      toast({
        title: "Error",
        description: "Failed to fetch image for upload.",
        variant: "destructive",
      });
      return;
    }
    const blob = await response.blob();

    // Validate the blob type before proceeding

    if (!allowedTypes.includes(blob.type as AllowedContentType)) {
      toast({
        title: "Invalid Image Type",
        description: `Unsupported image type: ${blob.type || "unknown"}. Please upload SVG, JPG, PNG, WEBP, or AVIF.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    generateUploadUrls(
      {
        entityId: entity.id,
        contentType: blob.type as AllowedContentType,
      },
      {
        onSuccess: async (data) => {
          await Promise.all(
            data.map(async (item) => {
              await fetch(item.signedUploadUrl, {
                method: "PUT",
                body: blob,
              });
            }),
          );
          updateEntity(
            {
              id: entity.id,
              screenShotLight: data[0]?.signedDownloadUrl,
              screenShotDark: data[1]?.signedDownloadUrl,
            },
            {
              onSuccess: async () => {
                toast({
                  title: "Thumbnail saved",
                });
                await revalidateDashboard();
                router.refresh();
                onOpenChange(false);
              },
              onSettled: () => {
                setIsUploading(false);
              },
              onError: (error) => {
                toast({
                  title: "Error",
                  description: `Failed to save thumbnail: ${error.message}`,
                  variant: "destructive",
                });
              },
            },
          );
        },
        onError: (error) => {
          setIsUploading(false);
          console.error(error);
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
