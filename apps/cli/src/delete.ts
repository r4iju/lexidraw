import type { ParsedArgs } from "./args";
import { type Context, json } from "./context";
import type { EntityKind } from "./entities";
import { CliError } from "./errors";
import { callApi } from "./http";
import { address, resolveEntity } from "./resolve";
import { type ApiSession, openSession } from "./session";

/**
 * `doc delete` and `drawing delete`. DELETE /entities/{id} takes any entity,
 * and a directory takes everything under it out of sight, so an id is checked
 * against the noun; --path only ever matches the noun's own kind.
 */
export async function deleteEntity(
  context: Context,
  args: ParsedArgs,
  kind: Exclude<EntityKind, "directory">,
): Promise<void> {
  const session = openSession(context);
  const target = address(args, kind, "write");
  const id = await resolveEntity(context, session, target);
  if (target.id !== undefined) await requireKind(session, id, kind);
  context.io.stdout(json(await trash(session, id)));
}

/**
 * The server deletes only the caller's own entities and answers NOT_FOUND for
 * the rest, which for one just read or listed means it is shared, not theirs.
 */
async function trash(session: ApiSession, id: string): Promise<unknown> {
  try {
    return await callApi(session, {
      method: "DELETE",
      path: `/entities/${encodeURIComponent(id)}`,
    });
  } catch (cause) {
    if (!(cause instanceof CliError) || cause.code !== "NOT_FOUND") throw cause;
    throw new CliError(
      "NOT_FOUND",
      `"${id}" was not deleted: only its owner can move it to the trash`,
      { details: { ...cause.details, id } },
    );
  }
}

/** What the entity with `id` is, where the path taken would not check. */
async function requireKind(
  session: ApiSession,
  id: string,
  kind: EntityKind,
): Promise<void> {
  const entity = await callApi(session, {
    method: "GET",
    path: `/entities/${encodeURIComponent(id)}`,
  });
  const entityType = (entity as { entityType?: unknown }).entityType;
  if (entityType === kind) return;
  throw new CliError(
    "NOT_FOUND",
    typeof entityType === "string"
      ? `"${id}" is a ${entityType}, not a ${kind}`
      : `"${id}" is not a ${kind}`,
    { details: { id, entityType } },
  );
}
