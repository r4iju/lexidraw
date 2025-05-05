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

import { toast } from "sonner";
import { api } from "~/trpc/react";
import { type RouterOutputs } from "~/trpc/shared";
import { Input } from "~/components/ui/input";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
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
  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const { sortBy, sortOrder } = z
    .object({
      sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .parse(Object.fromEntries(searchParams.entries()));

  const [shareWith, setShareWith] = useState<string>("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>(AccessLevel.READ);
  const [publicAccess, setPublicAccess] = useState<PublicAccess>(
    entity.publicAccess as PublicAccess,
  );

  /**
   * -------------------------------------
   * QUERY: GET SHARED USERS
   * -------------------------------------
   */
  const { data: sharedWithUsers } = api.entities.getSharedInfo.useQuery(
    { drawingId: entity.id },
    {
      enabled: isOpen,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  /**
   * -------------------------------------
   * MUTATION: PUBLIC SHARE
   * -------------------------------------
   */
  const { mutate: publicShare, isPending: publicShareIsLoading } =
    api.entities.update.useMutation({
      async onMutate(newShare) {
        // Cancel any ongoing fetches for the "list" query
        const queryKey = {
          parentId: entity.parentId ?? null,
          sortBy,
          sortOrder,
        } as const;
        await utils.entities.list.cancel(queryKey);

        // Snapshot previous list for rollback
        const previousData = utils.entities.list.getData(queryKey) ?? [];

        // Optimistically update
        utils.entities.list.setData(queryKey, (oldEntities) =>
          oldEntities
            ? oldEntities.map((item) =>
                item.id === entity.id
                  ? {
                      ...item,
                      publicAccess: newShare.publicAccess as PublicAccess,
                    }
                  : item,
              )
            : [],
        );

        return { queryKey, previousData };
      },
      onError(_error, _vars, context) {
        // Rollback to previous data
        if (!context) return;
        utils.entities.list.setData(context.queryKey, context.previousData);
      },
      onSuccess: async (_res, _vars, context) => {
        // Invalidate the list query to refetch fresh data
        if (!context) return;
        utils.entities.list.invalidate(context.queryKey);
        await revalidateDashboard();
      },
    });

  /**
   * -------------------------------------
   * MUTATION: SHARE WITH USER
   * -------------------------------------
   */
  const { mutate: shareWithUser, isPending: shareWithIsLoading } =
    api.entities.share.useMutation({
      async onMutate(newShare) {
        // Cancel any ongoing fetches for getSharedInfo
        const queryKey = { drawingId: newShare.drawingId };
        await utils.entities.getSharedInfo.cancel(queryKey);

        // Snapshot previous data
        const previousData =
          utils.entities.getSharedInfo.getData(queryKey) ?? [];

        // Clear the share input
        const previousInput = shareWith.toString();
        setShareWith("");

        // Optimistically add the new user
        utils.entities.getSharedInfo.setData(queryKey, (oldData) => [
          ...(oldData || []),
          {
            userId: "temp-id",
            name: newShare.userEmail,
            accessLevel: newShare.accessLevel,
            drawingId: newShare.drawingId,
            email: newShare.userEmail,
          },
        ]);

        return { queryKey, previousData, previousInput };
      },
      onError(_error, variables, context) {
        // Rollback
        if (!context) return;
        utils.entities.getSharedInfo.setData(
          context.queryKey,
          context.previousData,
        );
        setShareWith(context.previousInput);
        toast.error("Not found", {
          description: "Are you sure that email is valid?",
        });
      },
      onSuccess: async (_res, variables, context) => {
        // Invalidate to refetch fresh data
        if (!context) return;
        utils.entities.getSharedInfo.invalidate(context.queryKey);
        await revalidateDashboard();
      },
    });

  /**
   * -------------------------------------
   * MUTATION: CHANGE ACCESS LEVEL
   * -------------------------------------
   */
  const { mutate: changeAccessLevel, isPending: changeAccessLevelIsLoading } =
    api.entities.changeAccessLevel.useMutation({
      async onMutate({ drawingId, userId, accessLevel }) {
        const queryKey = { drawingId };
        await utils.entities.getSharedInfo.cancel(queryKey);

        const previousData =
          utils.entities.getSharedInfo.getData(queryKey) ?? [];

        // Optimistically update this user's access level
        utils.entities.getSharedInfo.setData(queryKey, (oldData) =>
          oldData?.map((user) =>
            user.userId === userId ? { ...user, accessLevel } : user,
          ),
        );

        return { queryKey, previousData };
      },
      onError(_err, vars, context) {
        if (!context) return;
        utils.entities.getSharedInfo.setData(
          context.queryKey,
          context.previousData,
        );
      },
      onSuccess: async (_res, vars, context) => {
        if (!context) return;
        utils.entities.getSharedInfo.invalidate(context.queryKey);
        toast.success("Saved");
        await revalidateDashboard();
      },
    });

  /**
   * -------------------------------------
   * MUTATION: UNSHARE
   * -------------------------------------
   */
  const { mutate: unshare, isPending: unshareIsLoading } =
    api.entities.unShare.useMutation({
      async onMutate({ drawingId, userId }) {
        const queryKey = { drawingId };
        await utils.entities.getSharedInfo.cancel(queryKey);

        const previousData =
          utils.entities.getSharedInfo.getData(queryKey) ?? [];

        // Optimistically remove this user
        utils.entities.getSharedInfo.setData(queryKey, (oldData) =>
          oldData?.filter((user) => user.userId !== userId),
        );

        return { queryKey, previousData };
      },
      onError(_err, vars, context) {
        if (!context) return;
        utils.entities.getSharedInfo.setData(
          context.queryKey,
          context.previousData,
        );
        toast.error("Error", {
          description: "Something went wrong",
        });
      },
      onSuccess: async (_res, variables, context) => {
        if (!context) return;
        utils.entities.getSharedInfo.invalidate(context.queryKey);
        await revalidateDashboard();
      },
    });

  /**
   * -------------------------------------
   * Handlers
   * -------------------------------------
   */
  const handleShareWith = () => {
    if (!shareWith) return;
    shareWithUser({
      drawingId: entity.id,
      userEmail: shareWith,
      accessLevel,
    });
  };

  const handleChangeAccessLevel = ({
    userId,
    accessLevel,
  }: {
    userId: string;
    accessLevel: AccessLevel;
  }) => {
    changeAccessLevel({
      drawingId: entity.id,
      userId,
      accessLevel,
    });
  };

  const handleUnshare = (userId: string) => {
    unshare({ userId, drawingId: entity.id });
  };

  const handleChangePublicAccess = (access: PublicAccess) => {
    setPublicAccess(access);
    publicShare({ id: entity.id, publicAccess: access });
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
          {/* Public Link */}
          <div className="gap-2">
            <div className="text-md font-semibold">Public link</div>
            <p>
              Please select the type of public access you want to give to this{" "}
              {entity.entityType}.
            </p>
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
                    {publicAccessLevelLabel[publicAccess as PublicAccess]}
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

          {/* Share with Specific Users */}
          <div className="gap-2">
            <div className="text-md font-semibold">Specific Users</div>
            <p>Share with individual users by entering their email address.</p>
            <div className="flex w-full flex-col gap-y-2 space-x-2 pt-2">
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

          {/* Shared With */}
          <div className="gap-2">
            <div className="text-md font-semibold">Shared with</div>
            <p>The following users have access to this {entity.entityType}.</p>
            <div className="space-y-2">
              {sharedWithUsers?.map((sharedUser) => (
                <div
                  key={sharedUser.userId}
                  className="flex items-center justify-between"
                >
                  <div className="flex gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
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
                      Unshare
                    </Button>
                  </div>
                </div>
              ))}
              {/* progress bar, when removing a user */}
              {unshareIsLoading && (
                <div className="w-full h-4 mt-2 animate-in slide-in-from-bottom-1">
                  <div className="h-full w-full bg-muted-foreground rounded-sm animate-pulse"></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
