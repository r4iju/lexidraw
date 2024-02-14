"use client";

import { type $Enums, PublicAccess } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";

type Props = {
  drawingId: string;
  currentAccess: $Enums.PublicAccess;
  revalidatePath: VoidFunction;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

// Convert access level enum to readable format
const accessLevelLabel = {
  [PublicAccess.PRIVATE]: "Private",
  [PublicAccess.READ]: "Anyone can view",
  [PublicAccess.EDIT]: "Anyone can edit",
};

export default function ShareDrawing({
  drawingId,
  currentAccess,
  revalidatePath,
  isOpen,
  onOpenChange,
}: Props) {
  const [access, setAccess] = useState<$Enums.PublicAccess>(currentAccess);
  const { mutate: share, isLoading } = api.drawings.update.useMutation();
  const { toast } = useToast();

  const handleSave = () => {
    share(
      { id: drawingId, publicAccess: access },
      {
        onSuccess: () => {
          toast({ title: "done!" });
          onOpenChange(false);
          revalidatePath();
        },
        onError: (error) => {
          toast({
            title: "Something went wrong!",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share drawing</DialogTitle>
          <DialogDescription className="flex flex-col">
            Please select the type of access you want to give to this drawing.
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2" variant="ghost">
                    {accessLevelLabel[access]} <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {Object.entries(PublicAccess).map(([key, value]) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={() => setAccess(value)}
                    >
                      {accessLevelLabel[value]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end space-x-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="default" onClick={handleSave} disabled={isLoading}>
              Save
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
