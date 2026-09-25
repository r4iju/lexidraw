import "server-only";
import type { AppBarAccount } from "~/components/app-bar/account-menu";
import type { EntityFrame } from "~/components/app-bar/entity-frame";
import { isAdmin } from "~/server/admin";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

/** Who the app bar says is signed in; null for a visitor. */
export async function appBarAccount(): Promise<AppBarAccount | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    isAdmin: await isAdmin(),
  };
}

/**
 * What the app bar over an open entity shows besides its title: the folders
 * above it that the viewer can open, and, to its owner, where it sits and who
 * else may open it.
 */
export async function entityFrame(id: string): Promise<EntityFrame> {
  const [account, entity] = await Promise.all([
    appBarAccount(),
    api.entities.getMetadata.query({ id }).catch(() => null),
  ]);
  const isOwner = Boolean(account && entity?.access === "owner");
  return {
    account,
    isOwner,
    parentId: isOwner ? (entity?.parentId ?? null) : null,
    ancestors: (entity?.ancestors ?? []).map(({ id, title }) => ({
      id,
      title,
    })),
  };
}
