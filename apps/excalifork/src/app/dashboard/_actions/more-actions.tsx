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
import DeleteDrawing from "./delete-drawing";
import { useState } from "react";
import { useToast } from "~/components/ui/use-toast";
import ShareDrawing from "./share-drawing";
import { PublicAccess } from "@packages/types";
import { type RouterOutputs } from "~/trpc/shared";

type Props = {
  drawing: RouterOutputs["drawings"]["list"][number];
  currentAccess: PublicAccess;
  revalidatePath: VoidFunction;
};

export function MoreActions({ drawing, currentAccess, revalidatePath }: Props) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const { toast } = useToast();

  const copyPublicLink = async () => {
    const url = `${window.location.origin}/${drawing.id}`;
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
              Share drawing
              <Share1Icon />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={copyPublicLink}
              disabled={currentAccess === PublicAccess.PRIVATE}
              className="justify-between"
            >
              Copy link
              <Link1Icon />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDrawing
        drawing={drawing}
        currentAccess={currentAccess}
        revalidatePath={revalidatePath}
        isOpen={isShareDialogOpen}
        onOpenChange={setIsShareDialogOpen}
      />
      <DeleteDrawing
        drawingId={drawing.id}
        revalidatePath={revalidatePath}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      />
    </>
  );
}
