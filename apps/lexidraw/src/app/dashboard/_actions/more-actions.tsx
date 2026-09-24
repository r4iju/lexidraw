"use client";

import type { PublicAccess } from "@packages/types";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  HeartIcon,
  HeartOffIcon,
  ImageIcon,
  LinkIcon,
  PencilIcon,
  ShareIcon,
  TagIcon,
  TrashIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ImageGenerationProvider } from "~/hooks/use-image-generation";
import { ImageProvider } from "~/hooks/use-image-insertion";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { copyEntityLink } from "./copy-link";
import DeleteEntity from "./delete-entity";
import ThumbnailModal from "./icon-modal";
import RenameEntityModal from "./rename-modal";
import ShareEntity from "./share-entity";
import TagEntityModal from "./tag-modal";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  currentAccess: PublicAccess;
};

export const MoreActions = ({ entity, currentAccess }: Props) => {
  const [openDialog, setOpenDialog] = useState<
    null | "delete" | "share" | "rename" | "tag" | "thumbnail"
  >(null);
  const pathname = usePathname();
  const prevPathnameRef = React.useRef<string | null>(null);

  // Close dialogs when route changes
  const closeDialog = React.useEffectEvent(() => {
    setOpenDialog(null);
  });

  useEffect(() => {
    if (
      prevPathnameRef.current !== null &&
      prevPathnameRef.current !== pathname
    ) {
      // Only close if pathname actually changed (navigation occurred)
      closeDialog();
    }
    prevPathnameRef.current = pathname;
  }, [pathname]);

  const handleCloseDialog = () => setOpenDialog(null);

  const { mutate: updatePrefs } = api.entities.updateUserPrefs.useMutation({
    onSuccess: async () => {
      await revalidateDashboard();
    },
  });

  const toggleFavorite = () => {
    const isFavorited = Boolean(entity.favoritedAt);
    updatePrefs(
      { entityId: entity.id, favorite: !isFavorited },
      {
        onSuccess: () =>
          toast.success(
            isFavorited
              ? `Removed “${entity.title}” from favorites.`
              : `Added “${entity.title}” to favorites.`,
          ),
        onError: () => toast.error("Couldn’t update favorites. Try again."),
      },
    );
  };

  const setArchived = (archive: boolean) =>
    updatePrefs(
      { entityId: entity.id, archive },
      {
        onSuccess: () =>
          archive
            ? toast.success(`Archived “${entity.title}”.`, {
                action: { label: "Undo", onClick: () => setArchived(false) },
              })
            : toast.success(`Moved “${entity.title}” back to Home.`),
        onError: () =>
          toast.error(
            archive
              ? `Couldn’t archive “${entity.title}”. Try again.`
              : `Couldn’t restore “${entity.title}”. Try again.`,
          ),
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost">
            <EllipsisIcon className="size-5" />
            <span className="sr-only">{`More actions for ${entity.title}`}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setOpenDialog("share")}
              className="justify-between"
            >
              Share…
              <ShareIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => copyEntityLink(entity, currentAccess)}
              className="justify-between"
            >
              Copy link
              <LinkIcon />
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setOpenDialog("rename")}
              className="justify-between"
            >
              Rename…
              <PencilIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setOpenDialog("tag")}
              className="justify-between"
            >
              Edit tags…
              <TagIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setOpenDialog("thumbnail")}
              className="justify-between"
            >
              Change thumbnail…
              <ImageIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={toggleFavorite}
              className="justify-between"
            >
              {entity.favoritedAt
                ? "Remove from favorites"
                : "Add to favorites"}
              {entity.favoritedAt ? <HeartOffIcon /> : <HeartIcon />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setArchived(!entity.archivedAt)}
              className="justify-between"
            >
              {entity.archivedAt ? "Unarchive" : "Archive"}
              {entity.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setOpenDialog("delete")}
            className="justify-between text-destructive focus:text-destructive"
          >
            Delete…
            <TrashIcon />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {openDialog === "delete" && (
        <DeleteEntity entity={entity} isOpen onOpenChange={handleCloseDialog} />
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
        <ImageGenerationProvider entityId={entity.id} signedIn>
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
