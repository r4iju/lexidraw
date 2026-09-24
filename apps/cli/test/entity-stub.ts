import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Env } from "../src/context";
import { startStub, type Stub } from "./helpers";

const openApi = await Bun.file(
  join(import.meta.dir, "fixtures", "openapi.json"),
).json();

/** Shared by every stub: the cache is keyed by origin, and each stub has its own. */
const cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-entity-stub-"));

/**
 * A stand-in for the entity and markdown REST paths: enough of the server's
 * behaviour — titles, parents, revisions, preconditions — that the commands
 * are driven end to end over HTTP.
 */
export type Row = {
  id: string;
  title: string;
  entityType: "document" | "directory";
  parentId: string | null;
  updatedAt: string;
  /** Markdown blocks, for a document. */
  blocks: string[];
};

export type Seed = Partial<Row> & Pick<Row, "id" | "title" | "entityType">;

/** Knobs a test turns to see what a command does when a call fails. */
export type Control = { failMarkdownWrites: boolean };

export type EntityStub = Stub & {
  rows: Map<string, Row>;
  control: Control;
};

export const TOKEN = "lxd_good";

/** Revisions are strictly increasing, so a precondition can be told apart. */
function clock(start: number): () => string {
  let tick = start;
  return () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
}

export function startEntityStub(seeds: readonly Seed[] = []): EntityStub {
  const now = clock(Date.parse("2026-01-01T00:00:00.000Z"));
  const rows = new Map<string, Row>();
  const control: Control = { failMarkdownWrites: false };
  for (const seed of seeds) {
    rows.set(seed.id, {
      parentId: null,
      updatedAt: now(),
      blocks: [],
      ...seed,
    });
  }

  const stub = startStub(async (url, request) => {
    if (url.pathname === "/api/v1/openapi.json") return Response.json(openApi);
    if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
      return fail(
        401,
        "UNAUTHORIZED",
        "Invalid, expired, or revoked API token",
      );
    }
    const path = url.pathname.replace("/api/v1", "");
    const body = await readBody(request);

    if (path === "/entities" && request.method === "GET") {
      return Response.json(children(rows, url));
    }
    if (path === "/entities" && request.method === "POST") {
      const row: Row = {
        id: String(body.id),
        title: String(body.title),
        entityType: body.entityType as Row["entityType"],
        parentId: (body.parentId as string | null) ?? null,
        updatedAt: now(),
        blocks: [],
      };
      rows.set(row.id, row);
      return Response.json(summary(row));
    }
    if (path === "/entities/search" && request.method === "GET") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      return Response.json(
        [...rows.values()]
          .filter((row) => row.title.toLowerCase().includes(query))
          .map(summary),
      );
    }

    const entity = path.match(/^\/entities\/([^/]+)$/);
    if (entity) {
      const row = rows.get(entity[1] as string);
      if (!row) return fail(404, "NOT_FOUND", "Drawing not found");
      if (request.method === "GET") return Response.json(loaded(row));
      if (request.method === "DELETE") {
        rows.delete(row.id);
        return Response.json({ id: row.id });
      }
    }

    const markdown = path.match(/^\/documents\/([^/]+)\/markdown(\/\w+)?$/);
    if (markdown) {
      const row = rows.get(markdown[1] as string);
      if (row?.entityType !== "document") {
        return fail(404, "NOT_FOUND", "Document not found");
      }
      if (request.method === "GET") return read(row, url);
      if (control.failMarkdownWrites) {
        return fail(500, "INTERNAL_SERVER_ERROR", "Internal server error");
      }
      return write(row, markdown[2] ?? "", body, now);
    }
    return fail(404, "NOT_FOUND", `no stub for ${request.method} ${path}`);
  });

  return { ...stub, rows, control };
}

/** `entities.load`: what an id names, whatever type it is. */
function loaded(row: Row) {
  return {
    id: row.id,
    title: row.title,
    entityType: row.entityType,
    appState: null,
    elements: "{}",
    publicAccess: "PRIVATE",
    sharedWith: [],
    accessLevel: "EDIT",
  };
}

function summary(row: Row) {
  return {
    id: row.id,
    title: row.title,
    entityType: row.entityType,
    parentId: row.parentId,
    updatedAt: row.updatedAt,
    createdAt: row.updatedAt,
  };
}

function children(rows: Map<string, Row>, url: URL) {
  const parentId = url.searchParams.get("parentId");
  const types = url.searchParams.get("entityTypes")?.split(",");
  return [...rows.values()]
    .filter((row) => (row.parentId ?? null) === parentId)
    .filter((row) => !types || types.includes(row.entityType))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summary);
}

function read(row: Row, url: URL): Response {
  const format = url.searchParams.get("format") ?? "markdown";
  const meta = {
    id: row.id,
    title: row.title,
    path: row.title,
    updatedAt: row.updatedAt,
    tags: [],
  };
  if (format === "json") {
    return Response.json({
      ...meta,
      format,
      content: { root: { children: [] } },
    });
  }
  const text = row.blocks.join("\n\n");
  return Response.json({
    ...meta,
    format,
    content:
      format === "raw"
        ? text
        : `---\nid: ${row.id}\ntitle: ${row.title}\n---\n\n${text}`,
  });
}

function write(
  row: Row,
  verb: string,
  body: Record<string, unknown>,
  now: () => string,
): Response {
  const since = body.ifUnmodifiedSince;
  if (verb !== "/append" && since === undefined) {
    return fail(400, "BAD_REQUEST", "Input validation failed", {
      issues: [{ message: "ifUnmodifiedSince: Required" }],
    });
  }
  if (since !== undefined && since !== row.updatedAt) {
    return fail(
      409,
      "CONFLICT",
      `Document was modified at ${row.updatedAt}; re-read it and retry with the new updatedAt`,
      { data: { currentUpdatedAt: row.updatedAt } },
    );
  }

  const added = String(body.markdown).split("\n\n");
  if (verb === "/append") {
    row.blocks = [...row.blocks, ...added];
  } else if (verb === "/insert") {
    const at = placement(row, body);
    if (at instanceof Response) return at;
    row.blocks.splice(at, 0, ...added);
  } else {
    row.blocks = added;
  }
  row.updatedAt = now();

  const counted =
    verb === "/append"
      ? { appendedBlocks: added.length }
      : verb === "/insert"
        ? { insertedBlocks: added.length }
        : { blocks: added.length };
  return Response.json({ id: row.id, updatedAt: row.updatedAt, ...counted });
}

function placement(row: Row, body: Record<string, unknown>): number | Response {
  if (typeof body.atBlockIndex === "number") return body.atBlockIndex;
  const heading = String(body.afterHeading);
  const found = row.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.replace(/^#+\s*/, "") === heading);
  if (found.length === 0) {
    return fail(400, "BAD_REQUEST", `No heading matches "${heading}"`);
  }
  const nth = typeof body.nth === "number" ? body.nth : 1;
  const picked = found[nth - 1];
  if (found.length > 1 && typeof body.nth !== "number") {
    return fail(400, "BAD_REQUEST", `"${heading}" matches several headings`, {
      data: {
        candidates: found.map(({ block, index }, order) => ({
          nth: order + 1,
          blockIndex: index,
          tag: "h1",
          text: block,
        })),
      },
    });
  }
  if (!picked) return fail(400, "BAD_REQUEST", `nth ${nth} is out of range`);
  return picked.index + 1;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "DELETE") return {};
  const text = await request.text();
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ message, code, ...extra }, { status });
}

/** The environment a command needs to reach `stub` with the stub's token. */
export function stubEnv(stub: Stub): Env {
  return {
    LEXIDRAW_PROFILE: "dev",
    LEXIDRAW_URL: stub.baseUrl,
    LEXIDRAW_TOKEN: TOKEN,
    XDG_CACHE_HOME: cacheHome,
  };
}
