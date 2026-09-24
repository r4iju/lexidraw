/// <reference types="bun" />
import { beforeAll, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import type { NextRequest } from "next/server";

import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();

/** Who `auth()` answers with; the route reads nothing else of the session. */
let session: { user: { id: string } } | null = null;
// Spread over the real module so a later test file that imports the rest of
// it, or `authEffective`, still gets the real thing.
const realAuth = await import("~/server/auth");
mock.module("~/server/auth", () => ({ ...realAuth, auth: () => session }));

const { POST } = await import("./route");

const OWNER = "agent_owner";
const STRANGER = "agent_stranger";
const PRIVATE_DOC = "agent_private_doc";

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "agent-owner@example.test" },
    { id: STRANGER, name: "Stranger", email: "agent-stranger@example.test" },
  ]);
  await db.insert(schema.entities).values({
    id: PRIVATE_DOC,
    title: "Private",
    elements: "{}",
    entityType: "document",
    userId: OWNER,
    publicAccess: PublicAccess.PRIVATE,
  });
});

function ask(documentId: string) {
  return POST(
    new Request("http://lexidraw.test/api/llm/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Summarize", documentId }),
    }) as unknown as NextRequest,
  );
}

test("a visitor with no account is told to sign in", async () => {
  session = null;
  expect((await ask(PRIVATE_DOC)).status).toBe(401);
});

test("a document the caller cannot read is not found", async () => {
  session = { user: { id: STRANGER } };
  expect((await ask(PRIVATE_DOC)).status).toBe(404);
});
