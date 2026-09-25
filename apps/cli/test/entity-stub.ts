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
 * A stand-in for the entity, markdown and drawing REST paths: enough of the
 * server's behaviour — titles, parents, revisions, preconditions — that the
 * commands are driven end to end over HTTP.
 */
export type Row = {
  id: string;
  title: string;
  entityType: "document" | "directory" | "drawing";
  parentId: string | null;
  updatedAt: string;
  /** Markdown blocks, for a document. */
  blocks: string[];
  /** Shared with the caller rather than theirs: readable, not deletable. */
  shared?: boolean;
  /** What a markdown read says it left out. */
  losses?: string[];
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
        // The server's delete finds only the caller's own entities.
        if (row.shared) return fail(404, "NOT_FOUND", "Entity not found");
        rows.delete(row.id);
        return Response.json({ id: row.id });
      }
    }

    const printed = path.match(/^\/documents\/([^/]+)\/render$/);
    if (printed) {
      const row = rows.get(printed[1] as string);
      if (row?.entityType !== "document") {
        return fail(404, "NOT_FOUND", "Document not found");
      }
      return Response.json(printedPdf(row, url));
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
    if (path === "/drawings" && request.method === "POST") {
      const row: Row = {
        id: crypto.randomUUID(),
        title: String(body.title),
        entityType: "drawing",
        parentId: (body.parentId as string | null) ?? null,
        updatedAt: now(),
        blocks: [],
      };
      rows.set(row.id, row);
      return Response.json({ id: row.id, updatedAt: row.updatedAt });
    }
    const drawing = path.match(/^\/drawings\/([^/]+)(\/render)?$/);
    if (drawing) {
      const row = rows.get(drawing[1] as string);
      if (row?.entityType !== "drawing") {
        return fail(404, "NOT_FOUND", "Drawing not found");
      }
      if (drawing[2]) return Response.json(rendered(row));
      if (request.method === "GET") return Response.json(drawn(row));
      if (body.ifUnmodifiedSince !== row.updatedAt) {
        return fail(
          409,
          "CONFLICT",
          `Drawing was modified at ${row.updatedAt}`,
        );
      }
      row.updatedAt = now();
      return Response.json({ id: row.id, updatedAt: row.updatedAt });
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

function drawn(row: Row) {
  return {
    id: row.id,
    title: row.title,
    elements: [],
    appState: {},
    updatedAt: row.updatedAt,
  };
}

/** An SVG that names the drawing, so a test can tell which one was drawn. */
function rendered(row: Row) {
  return {
    id: row.id,
    format: "svg",
    contentType: "image/svg+xml",
    encoding: "utf-8",
    width: 1,
    height: 1,
    data: `<svg>${row.id}</svg>`,
    updatedAt: row.updatedAt,
  };
}

/** A stand-in PDF that names the document and the page it was printed on. */
function printedPdf(row: Row, url: URL) {
  if (url.searchParams.get("format") === "png")
    return {
      id: row.id,
      format: "png",
      contentType: "image/png",
      encoding: "base64",
      data: Buffer.from(
        `PNG ${row.id} ${url.searchParams.get("width")} ${url.searchParams.get("theme")}${url.searchParams.get("touch") === "true" ? " touch" : ""}`,
      ).toString("base64"),
      updatedAt: row.updatedAt,
    };
  const page = `${url.searchParams.get("paper") ?? "A4"} ${url.searchParams.get("orientation") ?? "portrait"}`;
  return {
    id: row.id,
    format: "pdf",
    contentType: "application/pdf",
    encoding: "base64",
    data: Buffer.from(`%PDF ${row.id} ${page}`).toString("base64"),
    updatedAt: row.updatedAt,
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
    losses: row.losses ?? [],
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
  // The server's rule for an untitled document: its leading `# X` names it.
  const heading = /^# (.+)$/.exec(row.blocks[0] ?? "");
  if (heading && row.title === "Untitled") {
    row.title = heading[1] as string;
    row.blocks = row.blocks.slice(1);
  }
  row.updatedAt = now();

  const counted =
    verb === "/append"
      ? { appendedBlocks: added.length }
      : verb === "/insert"
        ? { insertedBlocks: added.length }
        : { blocks: added.length };
  // Enough of the server's interpretation notes to see them passed through.
  const notes = added
    .filter((block) => block.startsWith(":::"))
    .map((block) => `${block.split("\n")[0]} became a callout`);
  return Response.json({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    ...counted,
    notes,
  });
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
