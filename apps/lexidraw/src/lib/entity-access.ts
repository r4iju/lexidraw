import { AccessLevel, PublicAccess } from "@packages/types";

/**
 * What someone may do with an entity they can reach, least first: read it,
 * edit it, or, as its owner, decide who else has it and whether it exists.
 */
export const ENTITY_ACCESS = ["read", "edit", "owner"] as const;
export type EntityAccess = (typeof ENTITY_ACCESS)[number];

/**
 * The least access each action on an entity takes. The server refuses a call
 * by it and the menus offer an action by it, so the two cannot disagree.
 * Favorites and the archive are the caller's own view of Home, so reading an
 * entity is enough to file it there.
 */
export const ACTION_NEEDS = {
  open: "read",
  copyLink: "read",
  favorite: "read",
  archive: "read",
  rename: "edit",
  tags: "edit",
  thumbnail: "edit",
  move: "edit",
  share: "owner",
  publicAccess: "owner",
  delete: "owner",
} as const satisfies Record<string, EntityAccess>;
export type EntityAction = keyof typeof ACTION_NEEDS;

const atLeast = (access: EntityAccess, need: EntityAccess) =>
  ENTITY_ACCESS.indexOf(access) >= ENTITY_ACCESS.indexOf(need);

/** Whether someone with `access` to an entity may do `action` to it. */
export const may = (access: EntityAccess, action: EntityAction) =>
  atLeast(access, ACTION_NEEDS[action]);

/**
 * `userId`'s access to an entity they reached, from whose it is, their own
 * share of it and what it allows anyone. `userId` is "" for a visitor, who
 * owns nothing.
 */
export function accessOf(
  entity: {
    ownerId: string | null;
    sharedAccessLevel: string | null;
    publicAccess: string;
  },
  userId: string,
): EntityAccess {
  if (userId !== "" && entity.ownerId === userId) return "owner";
  if (
    entity.sharedAccessLevel === AccessLevel.EDIT ||
    entity.publicAccess === PublicAccess.EDIT
  ) {
    return "edit";
  }
  return "read";
}

/**
 * Whether dragging `item` onto `target` is a move the server takes: into a
 * folder the caller may write to, or to the top of Home when `target` is
 * null. Moving someone else's file into a folder also needs its owner to be
 * able to write there, which the caller cannot see, so only an owner is
 * offered a folder.
 */
export function mayDrop(
  item: { id: string; access: EntityAccess },
  target: { id: string; access: EntityAccess } | null,
): boolean {
  if (!may(item.access, "move")) return false;
  if (target === null) return true;
  return (
    target.id !== item.id &&
    item.access === "owner" &&
    atLeast(target.access, "edit")
  );
}
