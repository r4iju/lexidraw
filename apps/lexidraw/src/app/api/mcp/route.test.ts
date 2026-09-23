/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";

import { hashApiToken } from "~/server/auth/api-token-format";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
// After the runtime is installed, so the route's imports find the test
// database rather than opening the real one.
const { POST } = await import("./route");

const OWNER = "user_owner";
const STRANGER = "user_stranger";
const WRITE_TOKEN = "lxd_write";
const READ_TOKEN = "lxd_read";
const REVOKED_TOKEN = "lxd_revoked";
const EXPIRED_TOKEN = "lxd_expired";

let nextId = 0;

/**
 * A parsed JSON payload. Left loose on purpose: what a procedure answers with
 * is the router's business, and the assertion is what pins it down here.
 */
// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON, asserted on below
type Json = Record<string, any>;

/** One JSON-RPC message over the route, with whatever authorization. */
async function rpc(
  token: string | null,
  method: string,
  params?: Record<string, unknown>,
) {
  const response = await POST(
    new Request("http://lexidraw.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++nextId,
        method,
        ...(params ? { params } : {}),
      }),
    }),
  );
  return { response, body: await readMessage(response) };
}

/**
 * The single response message, whether the transport chose JSON or an SSE
 * stream for it.
 */
async function readMessage(response: Response): Promise<Json> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return text ? JSON.parse(text) : {};
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(data[data.length - 1] ?? "{}");
}

/** A tool call's payload, parsed back out of its text content. */
async function callTool(token: string, name: string, args: unknown) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  const result = body.result as
    | {
        isError?: boolean;
        content: { type: string; text: string }[];
        _meta?: Json;
      }
    | undefined;
  if (!result) throw new Error(`no result: ${JSON.stringify(body)}`);
  return {
    isError: result.isError === true,
    value: JSON.parse(result.content[0]?.text ?? "null") as Json,
    // What the host hands the preview widget, when the tool carries one.
    preview: result._meta?.["app.lexidraw/drawing"] as Json | undefined,
  };
}

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "owner@example.test" },
    { id: STRANGER, name: "Stranger", email: "stranger@example.test" },
  ]);
  await db.insert(schema.apiTokens).values([
    {
      id: "tok_write",
      userId: OWNER,
      name: "write",
      tokenHash: hashApiToken(WRITE_TOKEN),
      scope: "write",
    },
    {
      id: "tok_read",
      userId: OWNER,
      name: "read",
      tokenHash: hashApiToken(READ_TOKEN),
      scope: "read",
    },
    {
      id: "tok_revoked",
      userId: OWNER,
      name: "revoked",
      tokenHash: hashApiToken(REVOKED_TOKEN),
      scope: "write",
      revokedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      id: "tok_expired",
      userId: OWNER,
      name: "expired",
      tokenHash: hashApiToken(EXPIRED_TOKEN),
      scope: "write",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ]);
  await db.insert(schema.entities).values([
    owned("doc_other", "Someone else's", JSON.stringify(EMPTY_DOCUMENT), {
      userId: STRANGER,
    }),
    // Over a megabyte once it is markdown, which is the point.
    owned(
      "doc_huge",
      "War and peace",
      JSON.stringify(document("x".repeat(1_100_000))),
    ),
    owned("draw_huge", "A big one", JSON.stringify(hugeElements), {
      entityType: "drawing",
    }),
    owned("dir_owned", "Inbox", "{}", { entityType: "directory" }),
  ]);
});

/** A stored entity of the owner's, with the columns a row cannot omit. */
function owned(
  id: string,
  title: string,
  elements: string,
  overrides: { userId?: string; entityType?: string } = {},
) {
  return {
    id,
    title,
    elements,
    entityType: overrides.entityType ?? "document",
    userId: overrides.userId ?? OWNER,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

/** Four canonical elements, together well over the megabyte a read may send. */
const hugeElements = Array.from({ length: 4 }, (_, index) => ({
  id: `el_${index}`,
  type: "text",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  text: "y".repeat(300_000),
}));

/** A stored editor state whose one paragraph holds `text`. */
function document(text: string) {
  return {
    root: {
      children: [
        {
          key: "1",
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          textFormat: 0,
          textStyle: "",
          children: text
            ? [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text,
                  type: "text",
                  version: 1,
                  key: "t1",
                },
              ]
            : [],
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
      key: "root",
    },
  };
}

/** The state a new document carries: a root with one empty paragraph. */
const EMPTY_DOCUMENT = document("");

describe("the MCP endpoint", () => {
  test("introduces itself as lexidraw", async () => {
    const { response, body } = await rpc(WRITE_TOKEN, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      result: { serverInfo: { name: "lexidraw" } },
    });
    expect(body.result).toHaveProperty("instructions");
  });

  test("lists one tool per procedure", async () => {
    const { body } = await rpc(WRITE_TOKEN, "tools/list");
    const tools = body.result.tools as {
      name: string;
      description: string;
      inputSchema: unknown;
    }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "append_markdown",
      "create_document",
      "create_drawing",
      "get_document_markdown",
      "get_drawing",
      "insert_markdown",
      "list_entities",
      "put_drawing",
      "replace_markdown",
      "search_entities",
      "whoami",
    ]);
    // Every tool publishes a schema an agent can fill in, which is also the
    // only place the router's zod is asked to become JSON Schema.
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    // The drawing schemas are the ones that could have come out empty: their
    // elements are a checked union the router publishes through `.meta()`.
    for (const name of ["put_drawing", "create_drawing"]) {
      const schema = tools.find((tool) => tool.name === name)
        ?.inputSchema as Json;
      expect(schema.properties.elements).toMatchObject({ type: "array" });
      expect(schema.properties.elements.items).toBeDefined();
    }
  });

  test("resolves the token to its owner", async () => {
    const { value } = await callTool(READ_TOKEN, "whoami", {});
    expect(value).toEqual({
      userId: OWNER,
      email: "owner@example.test",
      authKind: "token",
      scope: "read",
    });
  });

  test("creates, appends to, and reads back a document", async () => {
    const created = await callTool(WRITE_TOKEN, "create_document", {
      title: "MCP notes",
    });
    expect(created.isError).toBe(false);
    const id = created.value.id as string;

    const appended = await callTool(WRITE_TOKEN, "append_markdown", {
      id,
      markdown: "## Findings\n\nThe endpoint answers.",
    });
    expect(appended.isError).toBe(false);
    expect(appended.value.appendedBlocks).toBe(2);

    const read = await callTool(READ_TOKEN, "get_document_markdown", { id });
    expect(read.isError).toBe(false);
    expect(read.value.content).toContain("## Findings");
    expect(read.value.content).toContain("The endpoint answers.");
    expect(read.value.updatedAt).toBe(appended.value.updatedAt);
  });

  test("refuses a mutation from a read-scope token", async () => {
    const created = await callTool(WRITE_TOKEN, "create_document", {
      title: "Read-only target",
    });
    const refused = await callTool(READ_TOKEN, "append_markdown", {
      id: created.value.id,
      markdown: "should not land",
    });
    expect(refused.isError).toBe(true);
    expect(refused.value.code).toBe("FORBIDDEN");

    const read = await callTool(READ_TOKEN, "get_document_markdown", {
      id: created.value.id,
    });
    expect(read.value.content).not.toContain("should not land");
  });

  test("answers a stale precondition with the revision to re-read from", async () => {
    const created = await callTool(WRITE_TOKEN, "create_document", {
      title: "Conflicted",
    });
    const stale = await callTool(WRITE_TOKEN, "replace_markdown", {
      id: created.value.id,
      markdown: "rewritten",
      ifUnmodifiedSince: "2020-01-01T00:00:00.000Z",
    });
    expect(stale.isError).toBe(true);
    expect(stale.value.code).toBe("CONFLICT");
    expect(stale.value.data.currentUpdatedAt).toBe(created.value.updatedAt);
  });

  test("keeps another user's document out of reach", async () => {
    const reached = await callTool(WRITE_TOKEN, "get_document_markdown", {
      id: "doc_other",
    });
    expect(reached.isError).toBe(true);
    // Existence stays private, so the answer is NOT_FOUND and not FORBIDDEN.
    expect(reached.value.code).toBe("NOT_FOUND");
  });

  test("names a rejected input the way /api/v1 does", async () => {
    const { value, isError } = await callTool(WRITE_TOKEN, "insert_markdown", {
      id: "doc_other",
      markdown: "x",
      afterHeading: "One",
      atBlockIndex: 0,
      ifUnmodifiedSince: "2026-09-01T00:00:00.000Z",
    });
    expect(isError).toBe(true);
    // The pretty-printed ZodError is never the message; `issues` carries it.
    expect(value.message).toBe("Input validation failed");
    expect(value.code).toBe("BAD_REQUEST");
    expect(value.issues).toMatchObject([
      {
        code: "custom",
        message: "pass exactly one of afterHeading or atBlockIndex",
      },
    ]);
    expect(value.issues[0].path).toBeDefined();
    // `data` is there whether or not a precondition was involved, so reading
    // `currentUpdatedAt` never has to test for the key first.
    expect(value.data).toEqual({ currentUpdatedAt: null, candidates: null });
    // What the REST adapter puts on `data` about this server stays here.
    expect(value.data.stack).toBeUndefined();
    expect(value.data.httpStatus).toBeUndefined();
    expect(value.data.path).toBeUndefined();
    expect(value.zodError).toBeUndefined();
  });

  test("rejects a blank markdown body at the published schema", async () => {
    const { body } = await rpc(WRITE_TOKEN, "tools/call", {
      name: "append_markdown",
      arguments: { id: "doc_other", markdown: "   " },
    });
    // A value the tool's own schema refuses never reaches a procedure, so it
    // comes back as the protocol error it is rather than as an API body. The
    // schema is the router's, so the two agree on what is refused.
    const result = body.result as Json;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("markdown must not be blank");
  });

  test("refuses to send a document that would not fit", async () => {
    const { value, isError } = await callTool(
      READ_TOKEN,
      "get_document_markdown",
      { id: "doc_huge" },
    );
    expect(isError).toBe(true);
    expect(value.code).toBe("PAYLOAD_TOO_LARGE");
    expect(value.message).toContain("lexidraw CLI");
    expect(value.message).toContain("/api/v1/documents/{id}/markdown");
  });

  test("refuses to send a drawing that would not fit", async () => {
    const { value, isError } = await callTool(READ_TOKEN, "get_drawing", {
      id: "draw_huge",
    });
    expect(isError).toBe(true);
    expect(value.code).toBe("PAYLOAD_TOO_LARGE");
    expect(value.message).toContain("/api/v1/drawings/{id}");
  });

  test("files a document in a directory of the caller's", async () => {
    const created = await callTool(WRITE_TOKEN, "create_document", {
      title: "Filed",
      parentId: "dir_owned",
    });
    expect(created.isError).toBe(false);
    expect(created.value.parentId).toBe("dir_owned");
    const listed = await callTool(READ_TOKEN, "list_entities", {
      parentId: "dir_owned",
    });
    expect(listed.value.map((row: Json) => row.id)).toContain(created.value.id);
  });

  test("refuses to file a document under something that is not a directory", async () => {
    const { value, isError } = await callTool(WRITE_TOKEN, "create_document", {
      title: "Misfiled",
      parentId: "doc_huge",
    });
    expect(isError).toBe(true);
    // A document is not a directory, and a directory of someone else's is not
    // reachable; neither case says which.
    expect(value.code).toBe("NOT_FOUND");
  });

  test("points the drawing tools at the preview widget", async () => {
    const { body } = await rpc(WRITE_TOKEN, "tools/list");
    const tools = body.result.tools as { name: string; _meta?: Json }[];
    const carrying = tools
      .filter((tool) => tool._meta?.ui?.resourceUri)
      .map((tool) => tool.name)
      .sort();
    expect(carrying).toEqual(["create_drawing", "get_drawing", "put_drawing"]);
    for (const tool of tools) {
      if (!tool._meta?.ui) continue;
      expect(tool._meta.ui.resourceUri).toBe("ui://lexidraw/drawing-preview");
      // The SDK writes the pre-1.0 key too, for hosts that only read that one.
      expect(tool._meta["ui/resourceUri"]).toBe(
        "ui://lexidraw/drawing-preview",
      );
    }
    // A client that knows nothing about MCP Apps still reads a plain tool.
    const drawing = tools.find((tool) => tool.name === "get_drawing") as Json;
    expect(drawing.inputSchema).toMatchObject({ type: "object" });
  });

  test("publishes the widget as an MCP Apps resource", async () => {
    const { body } = await rpc(READ_TOKEN, "resources/list");
    const resources = body.result.resources as Json[];
    const widget = resources.find(
      (resource) => resource.uri === "ui://lexidraw/drawing-preview",
    );
    expect(widget).toBeDefined();
    expect(widget?.mimeType).toBe("text/html;profile=mcp-app");
    // The fonts the editor loads are the only thing it fetches itself.
    expect(widget?._meta.ui.csp.resourceDomains).toEqual(["https://esm.sh"]);
    expect(widget?._meta.ui.csp.connectDomains).toEqual([]);
  });

  test("answers the widget as one self-contained document", async () => {
    const { body } = await rpc(READ_TOKEN, "resources/read", {
      uri: "ui://lexidraw/drawing-preview",
    });
    const contents = body.result.contents as Json[];
    expect(contents).toHaveLength(1);
    const document = contents[0] as Json;
    expect(document.mimeType).toBe("text/html;profile=mcp-app");
    const html = document.text as string;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // A whole editor, not a placeholder.
    expect(html.length).toBeGreaterThan(1_000_000);
    expect(html).toContain('<div id="root"></div>');
    // The bridge the widget talks to the host over, and the editor it mounts.
    expect(html).toContain("ui/initialize");
    expect(html).toContain("excalidraw-container");
    // One inline script, closed once: the editor's own `</script>` strings are
    // escaped, or the document would end in the middle of the bundle.
    expect(html.split("</script>")).toHaveLength(2);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(body.result._meta.ui.csp.resourceDomains).toEqual([
      "https://esm.sh",
    ]);
  });

  test("hands the widget what the server stored, not what was sent", async () => {
    const created = await callTool(WRITE_TOKEN, "create_drawing", {
      title: "Boxes",
      elements: [
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          label: { text: "one" },
        },
      ],
    });
    expect(created.isError).toBe(false);
    // The skeleton became canonical elements on the way in; the widget renders
    // those, so it never has to expand shorthand itself.
    expect(created.preview).toMatchObject({
      id: created.value.id,
      title: "Boxes",
      updatedAt: created.value.updatedAt,
      canWrite: true,
    });
    const elements = created.preview?.elements as Json[];
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(elements.map((element) => element.type)).toContain("rectangle");
    expect(elements.some((element) => element.text === "one")).toBe(true);

    const read = await callTool(READ_TOKEN, "get_drawing", {
      id: created.value.id,
    });
    // A read-scope token opens the widget read-only rather than letting a save
    // fail after the fact.
    expect(read.preview?.canWrite).toBe(false);
    expect(read.preview?.updatedAt).toBe(created.value.updatedAt);
    // A read already answers with the elements, and they are not repeated
    // under a second ceiling for the widget's benefit.
    expect(read.preview).not.toHaveProperty("elements");
    expect(read.value.elements.length).toBe(elements.length);
  });

  test("leaves the widget nothing to render when the drawing is too large", async () => {
    const { preview, isError } = await callTool(WRITE_TOKEN, "put_drawing", {
      id: "draw_huge",
      elements: hugeElements,
      ifUnmodifiedSince: "2026-09-01T00:00:00.000Z",
    });
    expect(isError).toBe(false);
    expect(preview?.elements).toBeNull();
    expect(preview?.tooLarge).toBe(true);
  });

  test("turns away an unauthenticated read of the widget", async () => {
    const { response, body } = await rpc(null, "resources/read", {
      uri: "ui://lexidraw/drawing-preview",
    });
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("turns away a request with no token", async () => {
    const { response, body } = await rpc(null, "tools/list");
    expect(response.status).toBe(401);
    expect(body).toEqual({
      message: "Missing API token; send Authorization: Bearer lxd_...",
      code: "UNAUTHORIZED",
      data: { currentUpdatedAt: null, candidates: null },
    });
  });

  test("turns away a revoked token", async () => {
    const { response, body } = await rpc(REVOKED_TOKEN, "tools/list");
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("turns away an expired token", async () => {
    const { response, body } = await rpc(EXPIRED_TOKEN, "tools/list");
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("turns away a browser session with no bearer header", async () => {
    const response = await POST(
      new Request("http://lexidraw.test/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          cookie: "next-auth.session-token=whatever",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await readMessage(response)).toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("turns away a token that was never issued", async () => {
    const { response, body } = await rpc("lxd_nonsense", "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
