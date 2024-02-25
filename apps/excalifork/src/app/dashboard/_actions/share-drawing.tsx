"use client";

import { type $Enums, PublicAccess, AccessLevel } from "@prisma/client";
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
import { type RouterOutputs } from "~/trpc/shared";
import { Input } from "~/components/ui/input";

type Props = {
  drawing: RouterOutputs["drawings"]["list"][number];
  currentAccess: $Enums.PublicAccess;
  revalidatePath: VoidFunction;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

const publicAccessLevelLabel = {
  [PublicAccess.PRIVATE]: "No public link",
  [PublicAccess.READ]: "Anyone with link can view",
  [PublicAccess.EDIT]: "Anyone with link can edit",
};

const accessLevelLabel = {
  [AccessLevel.EDIT]: "Edit",
  [AccessLevel.READ]: "View",
};

export default function ShareDrawing({
  drawing,
  currentAccess,
  revalidatePath,
  isOpen,
  onOpenChange,
}: Props) {
  const [shareWith, setShareWith] = useState<string>("");
  const [accessLevel, setAccessLevel] = useState<$Enums.AccessLevel>(
    AccessLevel.READ,
  );
  const { mutate: share, isLoading } = api.drawings.update.useMutation();
  const { mutate: shareWithUser } = api.drawings.share.useMutation();
  const { mutate: changeAccessLevel } =
    api.drawings.changeAccessLevel.useMutation();
  const { mutate: unshare } = api.drawings.unShare.useMutation();
  const { toast } = useToast();

  const handleShareWith = () => {
    if (!shareWith) return;
    shareWithUser(
      {
        drawingId: drawing.id,
        userEmail: shareWith,
        accessLevel: accessLevel,
      },
      {
        onSuccess: () => {
          setShareWith("");
          toast({
            title: "Shared!",
          });
          revalidatePath();
        },
        onError(error) {
          toast({
            title: "Something went wrong!",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  type ChangeAccessLevelProps = {
    userId: string;
    accessLevel: $Enums.AccessLevel;
  };

  const handleChangeAccessLevel = ({
    userId,
    accessLevel,
  }: ChangeAccessLevelProps) => {
    changeAccessLevel(
      {
        drawingId: drawing.id,
        userId: userId,
        accessLevel: accessLevel,
      },
      {
        onSuccess: () => {
          toast({
            title: "Access level changed!",
          });
          revalidatePath();
        },
      },
    );
  };

  const handleUnshare = (userId: string) => {
    unshare(
      { userId, drawingId: drawing.id },
      {
        onSuccess: () => {
          toast({
            title: "Unshared!",
          });
          revalidatePath();
        },
      },
    );
  };

  const handleChangePublicAccess = (publicAccess: $Enums.PublicAccess) => {
    share(
      { id: drawing.id, publicAccess: publicAccess },
      {
        onSuccess: () => {
          toast({ title: "Saved!" });
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
          <DialogDescription className="flex flex-col gap-2 py-4">
            <div className="h2 text-md font-bold">Public link</div>
            <div>
              Please select the type of public access you want to give to this
              drawing.
            </div>
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2" variant="outline">
                    {publicAccessLevelLabel[currentAccess]} <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {Object.entries(PublicAccess).map(([key, value]) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={() => handleChangePublicAccess(value)}
                    >
                      {publicAccessLevelLabel[value]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="h2 text-md font-bold">Specific Users</div>
            <div>
              Share with individual users by entering their email address.
            </div>
            <div className="flex w-full flex-col  gap-y-2 space-x-2 pt-2">
              <Input
                className="w-full"
                placeholder="Email"
                type="email"
                onChange={(e) => setShareWith(e.target.value)}
              />
              <div className="flex flex-row justify-end gap-x-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="gap-2" variant="outline">
                      {accessLevelLabel[accessLevel]} <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    {Object.entries(AccessLevel).map(([key, value]) => (
                      <DropdownMenuItem
                        key={key}
                        onSelect={() => setAccessLevel(value)}
                      >
                        {accessLevelLabel[value]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={handleShareWith}>Share</Button>
              </div>
            </div>
            <div className="h2 text-md font-bold">Shared with</div>
            <span>The following users have access to this drawing.</span>
            <div className="space-y-2">
              {drawing.sharedWith.map((sharedUser) => (
                <div
                  key={sharedUser.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                      {sharedUser.user.name[0]}
                    </span>
                    <span className="flex items-center">
                      {sharedUser.user.name}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                          {accessLevelLabel[sharedUser.accessLevel]}
                          <ChevronDownIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {Object.entries(AccessLevel).map(([key, value]) => (
                          <DropdownMenuItem
                            key={key}
                            onSelect={() =>
                              handleChangeAccessLevel({
                                userId: sharedUser.userId,
                                accessLevel: value,
                              })
                            }
                          >
                            {accessLevelLabel[value]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="destructive"
                      onClick={() => handleUnshare(sharedUser.userId)}
                    >
                      Unshare
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end space-x-4">
          <DialogClose asChild>
            <Button variant="outline" disabled={isLoading}>
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
