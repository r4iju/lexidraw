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
    | { isError?: boolean; content: { type: string; text: string }[] }
    | undefined;
  if (!result) throw new Error(`no result: ${JSON.stringify(body)}`);
  return {
    isError: result.isError === true,
    value: JSON.parse(result.content[0]?.text ?? "null") as Json,
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
  ]);
  await db.insert(schema.entities).values({
    id: "doc_other",
    title: "Someone else's",
    elements: JSON.stringify(EMPTY_DOCUMENT),
    entityType: "document",
    userId: STRANGER,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  });
});

/** A root with one empty paragraph, the state a new document carries. */
const EMPTY_DOCUMENT = {
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
        children: [],
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

  test("turns a bad tool input into an error the agent can read", async () => {
    const { value, isError } = await callTool(WRITE_TOKEN, "insert_markdown", {
      id: "doc_other",
      markdown: "x",
      afterHeading: "One",
      atBlockIndex: 0,
      ifUnmodifiedSince: "2026-09-01T00:00:00.000Z",
    });
    expect(isError).toBe(true);
    expect(value.code).toBe("BAD_REQUEST");
    expect(value.issues?.[0]?.message).toContain(
      "pass exactly one of afterHeading or atBlockIndex",
    );
  });

  test("turns away a request with no token", async () => {
    const { response, body } = await rpc(null, "tools/list");
    expect(response.status).toBe(401);
    expect(body).toEqual({
      message: "Missing API token; send Authorization: Bearer lxd_...",
      code: "UNAUTHORIZED",
    });
  });

  test("turns away a revoked token", async () => {
    const { response, body } = await rpc(REVOKED_TOKEN, "tools/list");
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED" });
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
