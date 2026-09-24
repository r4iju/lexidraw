"use client";

import type { PublicAccess } from "@packages/types";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { entityHref } from "~/lib/entity-types";
import { ImageGenerationProvider } from "~/hooks/use-image-generation";
import { ImageProvider } from "~/hooks/use-image-insertion";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { copyEntityLink } from "./copy-link";
import DeleteEntity from "./delete-entity";
import { EntityMenu } from "./entity-menu";
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
      <EntityMenu
        title={entity.title}
        href={entityHref(entity.entityType, entity.id)}
        favorited={Boolean(entity.favoritedAt)}
        archived={Boolean(entity.archivedAt)}
        onShare={() => setOpenDialog("share")}
        onCopyLink={() => copyEntityLink(entity, currentAccess)}
        onRename={() => setOpenDialog("rename")}
        onTags={() => setOpenDialog("tag")}
        onThumbnail={() => setOpenDialog("thumbnail")}
        onToggleFavorite={toggleFavorite}
        onToggleArchive={() => setArchived(!entity.archivedAt)}
        onDelete={() => setOpenDialog("delete")}
      />
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
