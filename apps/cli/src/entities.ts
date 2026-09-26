import { CliError } from "./errors";
import { callApi } from "./http";
import type { ApiSession } from "./session";

/** The entity types the nouns address. */
export type EntityKind = "document" | "directory" | "drawing";

/** What every listing carries and every command reads from a row. */
export type Entity = {
  id: string;
  title: string;
  entityType: string;
  updatedAt: string;
  parentId: string | null;
};

export type ListQuery = {
  /** Omitted or null lists the root. */
  parentId?: string | null;
  entityTypes?: readonly EntityKind[];
};

export async function listEntities(
  session: ApiSession,
  query: ListQuery,
): Promise<unknown[]> {
  const params: [string, string][] = [];
  if (query.parentId) params.push(["parentId", query.parentId]);
  if (query.entityTypes?.length) {
    params.push(["entityTypes", query.entityTypes.join(",")]);
  }
  const body = await callApi(session, {
    method: "GET",
    path: "/entities",
    query: params,
  });
  if (!Array.isArray(body)) {
    throw new CliError("BAD_RESPONSE", "GET /entities did not answer a list");
  }
  return body;
}

export async function createEntity(
  session: ApiSession,
  input: {
    title: string;
    // A drawing is created by POST /drawings, which takes the elements it
    // starts with.
    kind: Exclude<EntityKind, "drawing">;
    parentId: string | null;
  },
): Promise<{ id: string; created: Record<string, unknown> }> {
  // The id is the caller's to choose, as it is in the browser, so a follow-up
  // write to the new entity needs no read.
  const id = crypto.randomUUID();
  const body = await callApi(session, {
    method: "POST",
    path: "/entities",
    body: {
      id,
      title: input.title,
      entityType: input.kind,
      parentId: input.parentId,
    },
  });
  if (body === null || typeof body !== "object") {
    throw new CliError("BAD_RESPONSE", "POST /entities did not answer a row");
  }
  return { id, created: body as Record<string, unknown> };
}

/** The fields the CLI relies on, checked once so the rest can read them. */
export function entityRows(values: readonly unknown[]): Entity[] {
  return values.map((value) => {
    const row = (value ?? {}) as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string") {
      throw new CliError(
        "BAD_RESPONSE",
        "an entity row carries no id and title",
      );
    }
    return {
      id: row.id,
      title: row.title,
      entityType: typeof row.entityType === "string" ? row.entityType : "",
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
      parentId: typeof row.parentId === "string" ? row.parentId : null,
    };
  });
}
