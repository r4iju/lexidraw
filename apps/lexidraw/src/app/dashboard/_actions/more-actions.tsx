"use client";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  DotsHorizontalIcon,
  Link1Icon,
  Pencil1Icon,
  Share1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import DeleteDrawing from "./delete-entity";
import { useState } from "react";
import ShareEntity from "./share-entity";
import RenameEntityModal from "./rename-modal";
import ThumbnailModal from "./icon-modal";
import TagEntityModal from "./tag-modal";
import { PublicAccess } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { TagIcon } from "lucide-react";
import { Icon } from "@radix-ui/react-select";
import { ImageGenerationProvider } from "~/hooks/use-image-generation";
import { ImageProvider } from "~/hooks/use-image-insertion";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { revalidateDashboard } from "../server-actions";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  currentAccess: PublicAccess;
  llmConfig?: { openaiApiKey?: string } | null;
};

export const MoreActions = ({ entity, currentAccess, llmConfig }: Props) => {
  const [openDialog, setOpenDialog] = useState<
    null | "delete" | "share" | "rename" | "tag" | "thumbnail"
  >(null);

  const handleOpenDelete = () => setOpenDialog("delete");
  const handleOpenShare = () => setOpenDialog("share");
  const handleOpenRename = () => setOpenDialog("rename");
  const handleOpenTag = () => setOpenDialog("tag");
  const handleOpenThumbnail = () => setOpenDialog("thumbnail");
  const handleCloseDialog = () => setOpenDialog(null);

  const copyPublicLink = async () => {
    const url = `${window.location.origin}/${entity.entityType}s/${entity.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard!");
    } catch (err) {
      toast.error("Failed to copy link to clipboard!", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // mutations for favorite/archive
  const searchParams = useSearchParams();
  z.object({
    sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    view: z.enum(["all", "favorites", "archived"]).default("all"),
  }).parse(Object.fromEntries(searchParams.entries()));

  const { mutate: updatePrefs } = api.entities.updateUserPrefs.useMutation({
    onSuccess: async () => {
      await revalidateDashboard();
    },
  });

  const toggleFavorite = () => {
    const isFavorited = Boolean(entity.favoritedAt);
    updatePrefs({ entityId: entity.id, favorite: !isFavorited });
    toast.success(
      isFavorited ? "Removed from favorites" : "Added to favorites",
    );
  };
  const toggleArchive = () => {
    const isArchived = Boolean(entity.archivedAt);
    updatePrefs(
      { entityId: entity.id, archive: !isArchived },
      {
        onSuccess: () => {
          toast.success(isArchived ? "Unarchived" : "Archived");
        },
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost">
            <DotsHorizontalIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={toggleFavorite}
              className="justify-between"
            >
              {entity.favoritedAt ? "Unfavorite" : "Favorite"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={toggleArchive}
              className="justify-between"
            >
              {entity.archivedAt ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleOpenDelete}
              className="justify-between"
            >
              Delete
              <TrashIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleOpenShare}
              className="justify-between"
            >
              Share {entity.entityType}
              <Share1Icon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleOpenTag}
              className="justify-between"
            >
              Tag
              <TagIcon className="size-4" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleOpenRename}
              className="justify-between"
            >
              Rename
              <Pencil1Icon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleOpenThumbnail}
              className="justify-between"
            >
              Thumbnail
              <Icon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={copyPublicLink}
              disabled={
                currentAccess === PublicAccess.PRIVATE &&
                entity.sharedWithCount === 0
              }
              className="justify-between"
            >
              Copy link
              <Link1Icon />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {openDialog === "delete" && (
        <DeleteDrawing
          entity={entity}
          isOpen
          onOpenChange={handleCloseDialog}
        />
      )}
      {openDialog === "share" && (
        <ShareEntity entity={entity} isOpen onOpenChange={handleCloseDialog} />
      )}
      {openDialog === "rename" && (
        <RenameEntityModal
          entity={entity}
          isOpen
          onOpenChange={handleCloseDialog}
        />
      )}
      {openDialog === "tag" && (
        <TagEntityModal
          entity={entity}
          isOpen
          onOpenChange={handleCloseDialog}
        />
      )}
      {openDialog === "thumbnail" && (
        <ImageGenerationProvider
          initialConfig={llmConfig ?? null}
          entityId={entity.id}
        >
          <ImageProvider>
            <ThumbnailModal
              entity={entity}
              isOpen
              onOpenChange={handleCloseDialog}
            />
          </ImageProvider>
        </ImageGenerationProvider>
      )}
    </>
  );
};
