"use client";

import { PublicAccess, AccessLevel } from "@packages/types";
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
  entity: RouterOutputs["entities"]["list"][number];
  currentAccess: PublicAccess;
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
} as const;

export default function ShareDrawing({
  entity,
  currentAccess,
  revalidatePath,
  isOpen,
  onOpenChange,
}: Props) {
  const [shareWith, setShareWith] = useState<string>("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(AccessLevel.READ);
  const { data: sharedWith, refetch } = api.entities.getSharedInfo.useQuery(
    {
      drawingId: entity.id,
    },
    {
      enabled: isOpen,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const { mutate: share, isLoading } = api.entities.update.useMutation();
  const { mutate: shareWithUser } = api.entities.share.useMutation();
  const { mutate: changeAccessLevel } =
    api.entities.changeAccessLevel.useMutation();
  const { mutate: unshare } = api.entities.unShare.useMutation();
  const { toast } = useToast();

  const handleShareWith = () => {
    if (!shareWith) return;
    shareWithUser(
      {
        drawingId: entity.id,
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
          refetch();
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
    accessLevel: AccessLevel;
  };

  const handleChangeAccessLevel = ({
    userId,
    accessLevel,
  }: ChangeAccessLevelProps) => {
    changeAccessLevel(
      {
        drawingId: entity.id,
        userId: userId,
        accessLevel: accessLevel,
      },
      {
        onSuccess: () => {
          toast({
            title: "Access level changed!",
          });
          revalidatePath();
          refetch();
        },
      },
    );
  };

  const handleUnshare = (userId: string) => {
    unshare(
      { userId, drawingId: entity.id },
      {
        onSuccess: () => {
          toast({
            title: "Unshared!",
          });
          revalidatePath();
          refetch();
        },
      },
    );
  };

  const handleChangePublicAccess = (publicAccess: PublicAccess) => {
    share(
      { id: entity.id, publicAccess: publicAccess },
      {
        onSuccess: () => {
          toast({ title: "Saved!" });
          revalidatePath();
          refetch();
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
          <DialogTitle>Share {entity.entityType}</DialogTitle>
          <DialogDescription className="flex flex-col gap-6 py-4">
            <div className="gap-2">
              <div className="h2 text-md font-bold">Public link</div>
              <div>
                Please select the type of public access you want to give to this{" "}
                {entity.entityType}.
              </div>
              <div className="flex full-w justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="gap-2" variant="outline">
                      {publicAccessLevelLabel[currentAccess]}{" "}
                      <ChevronDownIcon />
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
            </div>
            <div className="gap-2">
              <div className="h2 text-md font-bold">Specific Users</div>
              <div>
                Share with individual users by entering their email address.
              </div>
              <div className="flex w-full flex-col  gap-y-2 space-x-2 pt-2">
                <Input
                  className="w-full"
                  placeholder="Email"
                  type="email"
                  value={shareWith}
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
            </div>
            <div className="gap-2">
              <div className="h2 text-md font-bold">Shared with</div>
              <span>
                The following users have access to this {entity.entityType}.
              </span>
              <div className="space-y-2">
                {sharedWith?.map((sharedUser) => (
                  <div
                    key={sharedUser.userId}
                    className="flex items-center justify-between"
                  >
                    <div className="flex gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                        {sharedUser.name ? sharedUser.name[0] : ""}
                      </span>
                      <span className="flex items-center">
                        {sharedUser.name}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline">
                            {
                              accessLevelLabel[
                                sharedUser.accessLevel as AccessLevel
                              ]
                            }
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
