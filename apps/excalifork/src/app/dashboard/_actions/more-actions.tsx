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
  Share1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import DeleteDrawing from "./delete-entity";
import { useState } from "react";
import { useToast } from "~/components/ui/use-toast";
import ShareEntity from "./share-entity";
import { PublicAccess } from "@packages/types";
import { type RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  currentAccess: PublicAccess;
  revalidatePath: () => Promise<void>;
};

export function MoreActions({ entity, currentAccess, revalidatePath }: Props) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const { toast } = useToast();

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
          <Button variant="ghost">
            <DotsHorizontalIcon className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setIsDeleteDialogOpen(true)}
              className="justify-between"
            >
              Delete
              <TrashIcon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setIsShareDialogOpen(true)}
              className="justify-between"
            >
              Share {entity.entityType}
              <Share1Icon />
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
      <ShareEntity
        entity={entity}
        revalidatePath={revalidatePath}
        isOpen={isShareDialogOpen}
        onOpenChange={setIsShareDialogOpen}
      />
      <DeleteDrawing
        entity={entity}
        revalidatePath={revalidatePath}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      />
    </>
  );
}
