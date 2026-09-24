import type { ParsedArgs } from "./args";
import { type Context, json } from "./context";
import type { EntityKind } from "./entities";
import { CliError } from "./errors";
import { callApi } from "./http";
import { address, resolveEntity } from "./resolve";
import { type ApiSession, openSession } from "./session";

/**
 * `doc delete` and `drawing delete`. DELETE /entities/{id} takes any entity, a
 * directory with everything under it included, so an id is checked against the
 * noun; --path only ever matches the noun's own kind.
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
  context.io.stdout(
    json(
      await callApi(session, {
        method: "DELETE",
        path: `/entities/${encodeURIComponent(id)}`,
      }),
    ),
  );
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
