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
import { useToast } from "~/components/ui/toast-provider";
import ShareEntity from "./share-entity";
import RenameEntityModal from "./rename-modal";
import TagEntityModal from "./tag-modal";
import { PublicAccess } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { TagIcon } from "lucide-react";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  currentAccess: PublicAccess;
};

export const MoreActions = ({ entity, currentAccess }: Props) => {
  const { toast } = useToast();

  const [openDialog, setOpenDialog] = useState<
    null | "delete" | "share" | "rename" | "tag"
  >(null);

  const handleOpenDelete = () => setOpenDialog("delete");
  const handleOpenShare = () => setOpenDialog("share");
  const handleOpenRename = () => setOpenDialog("rename");
  const handleOpenTag = () => setOpenDialog("tag");

  const handleCloseDialog = () => setOpenDialog(null);

  const copyPublicLink = async () => {
    const url = `${window.location.origin}/${entity.entityType}s/${entity.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied to clipboard!",
      });
    } catch (err) {
      toast({
        title: "Failed to copy link to clipboard!",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
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
    </>
  );
};
