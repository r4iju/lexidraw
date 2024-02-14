"use client";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import DeleteDrawing from "./delete-drawing";
import { useState } from "react";
import { useToast } from "~/components/ui/use-toast";
import ShareDrawing from "./share-drawing";
import { $Enums, PublicAccess } from "@prisma/client";

type Props = {
  drawingId: string;
  currentAccess: $Enums.PublicAccess;
  revalidatePath: VoidFunction;
};

export function MoreActions({
  drawingId,
  currentAccess,
  revalidatePath,
}: Props) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const { toast } = useToast();

  const copyPublicLink = async () => {
    const url = `${window.location.origin}/${drawingId}`;
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
            <DropdownMenuItem onSelect={() => setIsDeleteDialogOpen(true)}>
              Delete
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsShareDialogOpen(true)}>
              Share drawing
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={copyPublicLink}
              disabled={currentAccess === PublicAccess.PRIVATE}
            >
              Copy shareable link
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDrawing
        drawingId={drawingId}
        currentAccess={currentAccess}
        revalidatePath={revalidatePath}
        isOpen={isShareDialogOpen}
        onOpenChange={setIsShareDialogOpen}
      />
      <DeleteDrawing
        drawingId={drawingId}
        revalidatePath={revalidatePath}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      />
    </>
  );
}
