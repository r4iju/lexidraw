/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import {
  ACTION_NEEDS,
  type EntityAccess,
  type EntityAction,
  may,
  mayDrop,
} from "~/lib/entity-access";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

type Caller = ReturnType<typeof entityRouter.createCaller>;
const callerOf = (userId: string): Caller =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);

const OWNER = "eact_owner";
const ROLES = {
  owner: OWNER,
  editor: "eact_editor",
  reader: "eact_reader",
} as const;
type Role = keyof typeof ROLES;
const ROLE_ACCESS: Record<Role, EntityAccess> = {
  owner: "owner",
  editor: "edit",
  reader: "read",
};

// The owner's folder the files are in, and one to move them to; both shared
// for editing with the editor and for reading with the reader, as the files
// are.
const FOLDER = "eact_folder";
const DEST = "eact_dest";
// A folder of the caller's own.
const mine = (role: Role) => `eact_mine_${role}`;

/** The call behind each action, as the dashboard makes it. */
const perform: Record<
  EntityAction,
  (caller: Caller, id: string) => Promise<unknown>
> = {
  open: (caller, id) => caller.load({ id }),
  // A link is the entity's address; the one who follows it has to be able to
  // open it.
  copyLink: (caller, id) => caller.load({ id }),
  favorite: (caller, id) =>
    caller.updateUserPrefs({ entityId: id, favorite: true }),
  archive: (caller, id) =>
    caller.updateUserPrefs({ entityId: id, archive: true }),
  rename: (caller, id) => caller.update({ id, title: "Renamed" }),
  tags: (caller, id) => caller.updateEntityTags({ id, tagNames: ["eact"] }),
  thumbnail: (caller, id) =>
    caller.update({ id, screenShotLight: "https://example.test/light.png" }),
  move: (caller, id) => caller.update({ id, parentId: DEST }),
  share: (caller, id) =>
    caller.share({
      id,
      userEmail: "eact-other@example.test",
      accessLevel: AccessLevel.READ,
    }),
  publicAccess: (caller, id) =>
    caller.update({ id, publicAccess: PublicAccess.READ }),
  delete: (caller, id) => caller.delete({ id }),
};
const ACTIONS = Object.keys(ACTION_NEEDS) as EntityAction[];
const DROP_TARGETS = ["home", "dest", "mine"] as const;

const at = new Date("2026-09-01T00:00:00.000Z");
const entity = (
  id: string,
  entityType: string,
  parentId: string | null,
  userId = OWNER,
) => ({
  id,
  title: id,
  elements: "{}",
  entityType,
  userId,
  parentId,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
});
const sharedAsFolderIs = (entityId: string) => [
  {
    id: `${entityId}-${ROLES.editor}`,
    entityId,
    userId: ROLES.editor,
    accessLevel: AccessLevel.EDIT,
  },
  {
    id: `${entityId}-${ROLES.reader}`,
    entityId,
    userId: ROLES.reader,
    accessLevel: AccessLevel.READ,
  },
];

const fileFor = (role: Role, what: string) => `eact_${role}_${what}`;
const roles = Object.keys(ROLES) as Role[];

beforeAll(async () => {
  await db.insert(schema.users).values([
    ...roles.map((role) => ({
      id: ROLES[role],
      name: role,
      email: `eact-${role}@example.test`,
    })),
    { id: "eact_other", name: "Other", email: "eact-other@example.test" },
  ]);
  const files = roles.flatMap((role) => [
    ...ACTIONS.map((action) => fileFor(role, action)),
    ...DROP_TARGETS.map((target) => fileFor(role, `drop_${target}`)),
  ]);
  await db
    .insert(schema.entities)
    .values([
      entity(FOLDER, "directory", null),
      entity(DEST, "directory", null),
      ...roles.map((role) =>
        entity(mine(role), "directory", null, ROLES[role]),
      ),
      ...files.map((id) => entity(id, "document", FOLDER)),
    ]);
  await db
    .insert(schema.sharedEntities)
    .values([FOLDER, DEST, ...files].flatMap(sharedAsFolderIs));
});

/** Each of the caller's files in the folder, with the access `list` says they have. */
async function listed(role: Role) {
  const items = await callerOf(ROLES[role]).list({ parentId: FOLDER });
  return new Map(items.map((item) => [item.id, item]));
}

const outcome = (call: Promise<unknown>) =>
  call.then(
    () => "accepted",
    () => "refused",
  );

describe("the menu and the server agree on what each caller may do", () => {
  test.each(roles)("a listing tells the %s their own access", async (role) => {
    const items = await listed(role);
    for (const action of ACTIONS) {
      expect(items.get(fileFor(role, action))?.access).toBe(ROLE_ACCESS[role]);
    }
  });

  test.each(roles)(
    "every action offered to the %s is accepted, and every one withheld is refused",
    async (role) => {
      const items = await listed(role);
      const caller = callerOf(ROLES[role]);
      for (const action of ACTIONS) {
        const item = items.get(fileFor(role, action));
        if (!item) throw new Error(`${fileFor(role, action)} is not listed`);
        expect({
          action,
          result: await outcome(perform[action](caller, item.id)),
        }).toEqual({
          action,
          result: may(item.access, action) ? "accepted" : "refused",
        });
      }
    },
  );

  test.each(roles)(
    "every drop offered to the %s is a move the server makes",
    async (role) => {
      const caller = callerOf(ROLES[role]);
      const items = await listed(role);
      const home = new Map(
        (await caller.list({})).map((item) => [item.id, item]),
      );
      const targets = {
        home: null,
        dest: home.get(DEST),
        mine: home.get(mine(role)),
      };
      for (const name of DROP_TARGETS) {
        const target = targets[name];
        if (target === undefined) throw new Error(`${name} is not listed`);
        const item = items.get(fileFor(role, `drop_${name}`));
        if (!item) throw new Error(`the ${name} file is not listed`);
        const result = await outcome(
          caller.update({ id: item.id, parentId: target?.id ?? null }),
        );
        // Whether someone else's file may go into a folder the caller may
        // write to turns on its owner, whom the caller cannot see; that drop
        // is withheld, whatever the server would say.
        const turnsOnOwner =
          item.access === "edit" && target !== null && target.access !== "read";
        if (!turnsOnOwner) {
          expect({ name, result }).toEqual({
            name,
            result: mayDrop(item, target) ? "accepted" : "refused",
          });
        }
      }
    },
  );
});
