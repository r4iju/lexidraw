"use client";

import { AccessLevel, type PublicAccess } from "@packages/types";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { copyEntityLink } from "./copy-link";
import { type SharePerson, SharePanel } from "./share-panel";

/** The optimistic row's id: it has no share to change until the server answers. */
const PENDING_SHARE_ID = "temp-id";

type SharedInfo = RouterOutputs["entities"]["getSharedInfo"];

/** What the dialog reads of the file, which a listing row and an open file both have. */
export type Shareable = Pick<
  RouterOutputs["entities"]["list"][number],
  "id" | "title" | "entityType" | "publicAccess"
>;

type Props = {
  entity: Shareable;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export default function ShareEntity({ entity, isOpen, onOpenChange }: Props) {
  const utils = api.useUtils();
  const { data: session } = useSession();
  const queryKey = { id: entity.id };
  const [publicAccess, setPublicAccess] = useState(entity.publicAccess);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data: shares = [] } = api.entities.getSharedInfo.useQuery(queryKey, {
    enabled: isOpen,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const refresh = async () => {
    await utils.entities.getSharedInfo.invalidate(queryKey);
    await revalidateDashboard();
  };

  /** Applies a change to the list at once, and hands back the list to restore. */
  const optimistic = async (change: (rows: SharedInfo) => SharedInfo) => {
    await utils.entities.getSharedInfo.cancel(queryKey);
    const previous = utils.entities.getSharedInfo.getData(queryKey) ?? [];
    utils.entities.getSharedInfo.setData(queryKey, change(previous));
    return previous;
  };

  /**
   * A failed change restores the list, then refetches it: a share another tab
   * already revoked is NOT_FOUND, and the list should show what is left.
   */
  const rollBack = async (
    message: string,
    previous: SharedInfo | undefined,
  ) => {
    toast.error(message);
    if (previous) utils.entities.getSharedInfo.setData(queryKey, previous);
    await refresh();
  };

  const publicShare = api.entities.update.useMutation({
    onSuccess: async () => {
      await utils.entities.list.invalidate();
      await revalidateDashboard();
    },
  });

  const share = api.entities.share.useMutation({
    onMutate: (input) => {
      setInviteError(null);
      return optimistic((rows) => [
        ...rows,
        {
          entityId: input.id,
          userId: PENDING_SHARE_ID,
          name: null,
          email: input.userEmail,
          accessLevel: input.accessLevel,
        },
      ]);
    },
    onError: (error, input, previous) => {
      if (previous) utils.entities.getSharedInfo.setData(queryKey, previous);
      setInviteError(
        error.data?.code === "NOT_FOUND"
          ? `No Lexidraw account uses ${input.userEmail}. Ask them to sign up, then share again.`
          : `Couldn’t share with ${input.userEmail}. Try again.`,
      );
    },
    onSuccess: async (_result, input) => {
      toast.success(
        `${input.userEmail} can now ${input.accessLevel === AccessLevel.EDIT ? "edit" : "view"} “${entity.title}”.`,
      );
      await refresh();
    },
  });

  const changeAccessLevel = api.entities.changeAccessLevel.useMutation({
    onMutate: ({ userId, accessLevel }) =>
      optimistic((rows) =>
        rows.map((row) =>
          row.userId === userId ? { ...row, accessLevel } : row,
        ),
      ),
    onError: (_error, _input, previous) =>
      rollBack("Couldn’t change their access. Try again.", previous),
    onSuccess: async (_result, { userId, accessLevel }) => {
      const person = shares.find((row) => row.userId === userId);
      toast.success(
        `${person?.name ?? person?.email ?? "They"} can now ${accessLevel === AccessLevel.EDIT ? "edit" : "view"} “${entity.title}”.`,
      );
      await refresh();
    },
  });

  const unShare = api.entities.unShare.useMutation({
    onMutate: ({ userId }) =>
      optimistic((rows) => rows.filter((row) => row.userId !== userId)),
    onError: (_error, _input, previous) =>
      rollBack("Couldn’t remove their access. Try again.", previous),
    onSuccess: refresh,
  });

  const people: SharePerson[] = shares.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    accessLevel: row.accessLevel,
    pending: row.userId === PENDING_SHARE_ID,
  }));

  const remove = (userId: string) => {
    const person = shares.find((row) => row.userId === userId);
    if (!person) return;
    const who = person.name ?? person.email ?? "They";
    unShare.mutate(
      { id: entity.id, userId },
      {
        onSuccess: () => {
          toast.success(`Removed ${who}’s access to “${entity.title}”.`, {
            action: person.email
              ? {
                  label: "Undo",
                  onClick: () =>
                    share.mutate({
                      id: entity.id,
                      userEmail: person.email as string,
                      accessLevel: person.accessLevel,
                    }),
                }
              : undefined,
          });
        },
      },
    );
  };

  return (
    <SharePanel
      open={isOpen}
      onOpenChange={onOpenChange}
      entity={entity}
      you={{
        name: session?.user?.name ?? null,
        email: session?.user?.email ?? null,
      }}
      people={people}
      publicAccess={publicAccess}
      onPublicAccessChange={(next) => {
        const previous = publicAccess;
        setPublicAccess(next);
        publicShare.mutate(
          { id: entity.id, publicAccess: next },
          {
            onError: () => {
              setPublicAccess(previous);
              toast.error("Couldn’t change who can open it. Try again.");
            },
          },
        );
      }}
      onInvite={(email, accessLevel) =>
        share.mutate({ id: entity.id, userEmail: email, accessLevel })
      }
      inviting={share.isPending}
      inviteError={inviteError}
      onRoleChange={(userId, accessLevel) =>
        changeAccessLevel.mutate({ id: entity.id, userId, accessLevel })
      }
      onRemove={remove}
      onCopyLink={() => copyEntityLink(entity, publicAccess as PublicAccess)}
    />
  );
}
