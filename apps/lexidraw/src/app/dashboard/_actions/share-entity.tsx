"use client";

import { PublicAccess, AccessLevel } from "@packages/types";
import { ChevronDownIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { useRouter } from "next/navigation";
import { revalidateDashboard } from "../server-actions";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
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

export default function ShareEntity({ entity, isOpen, onOpenChange }: Props) {
  const router = useRouter();
  const [shareWith, setShareWith] = useState<string>("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(AccessLevel.READ);
  const [publicAccess, setPublicAccess] = useState<PublicAccess>(
    entity.publicAccess as PublicAccess,
  );

  const { refetch, data: sharedWithUsers } =
    api.entities.getSharedInfo.useQuery(
      {
        drawingId: entity.id,
      },
      {
        enabled: isOpen,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    );
  const { mutate: publicShare, isPending: publicShareIsLoading } =
    api.entities.update.useMutation();
  const { mutate: shareWithUser, isPending: shareWithIsLoading } =
    api.entities.share.useMutation();
  const { mutate: changeAccessLevel, isPending: changeAccessLevelIsLoading } =
    api.entities.changeAccessLevel.useMutation();
  const { mutate: unshare, isPending: unshareIsLoading } =
    api.entities.unShare.useMutation();
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
        onSuccess: async () => {
          setShareWith("");
          refetch();
          await revalidateDashboard();
          router.refresh();
          toast({
            title: "Shared!",
          });
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
        onSuccess: async () => {
          refetch();
          await revalidateDashboard();
          router.refresh();
          toast({
            title: "Access level changed!",
          });
        },
      },
    );
  };

  const handleUnshare = (userId: string) => {
    unshare(
      { userId, drawingId: entity.id },
      {
        onSuccess: async () => {
          refetch();
          await revalidateDashboard();
          router.refresh();
          toast({
            title: "Unshared!",
          });
        },
      },
    );
  };

  const handleChangePublicAccess = (publicAccess: PublicAccess) => {
    setPublicAccess(publicAccess);
    publicShare(
      { id: entity.id, publicAccess: publicAccess },
      {
        onSuccess: async () => {
          refetch();
          await revalidateDashboard();
          router.refresh();
          toast({ title: "Saved!" });
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
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="dialog-description"
      >
        <DialogHeader>
          <DialogTitle>Share {entity.entityType}</DialogTitle>
        </DialogHeader>
        <div id="dialog-description" className="sr-only">
          Share settings for {entity.entityType}. You can adjust public access,
          share with specific users, or modify permissions for existing users.
        </div>
        <div className="flex flex-col gap-6 py-4">
          <div className="gap-2">
            <div className="text-md font-semibold">Public link</div>
            <div>
              Please select the type of public access you want to give to this{" "}
              {entity.entityType}.
            </div>
            <div className="flex full-w justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="gap-2"
                    variant="outline"
                    disabled={publicShareIsLoading}
                  >
                    {publicShareIsLoading && (
                      <ReloadIcon className="animate-spin w-4 mr-2" />
                    )}
                    {publicAccessLevelLabel[publicAccess as PublicAccess]}{" "}
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
            <div className="text-md font-semibold">Specific Users</div>
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
                <Button disabled={shareWithIsLoading} onClick={handleShareWith}>
                  {shareWithIsLoading && (
                    <ReloadIcon className="animate-spin w-4 mr-2" />
                  )}
                  Share
                </Button>
              </div>
            </div>
          </div>
          <div className="gap-2">
            <div className="text-md font-semibold">Shared with</div>
            <span>
              The following users have access to this {entity.entityType}.
            </span>
            <div className="space-y-2">
              {sharedWithUsers?.map((sharedUser) => (
                <div
                  key={sharedUser.userId}
                  className="flex items-center justify-between"
                >
                  <div className="flex gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200">
                      {sharedUser.name ? sharedUser.name[0] : ""}
                    </span>
                    <span className="flex items-center">{sharedUser.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          disabled={changeAccessLevelIsLoading}
                          variant="outline"
                        >
                          {changeAccessLevelIsLoading && (
                            <ReloadIcon className="animate-spin w-4 mr-2" />
                          )}
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
                      disabled={unshareIsLoading}
                      onClick={() => handleUnshare(sharedUser.userId)}
                    >
                      {unshareIsLoading && (
                        <ReloadIcon className="animate-spin w-4 mr-2" />
                      )}
                      Unshare
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
