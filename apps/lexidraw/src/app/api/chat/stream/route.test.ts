import { afterAll, expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import * as schema from "@packages/drizzle/drizzle-schema";
import { hashApiToken } from "~/server/auth/api-token-format";
import { supplierFixture } from "~/test/supplier-fixture";
import { installServerRuntime } from "~/test/server-runtime";

mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
let cookieAccount: string | null = null;
mock.module("~/server/auth", () => ({
  authEffective: async () =>
    cookieAccount ? { user: { id: cookieAccount } } : null,
}));
// Request-scoped lifetime extension only exists inside a Next server.
const retained: Promise<unknown>[] = [];
const realServer = await import("next/server");
mock.module("next/server", () => ({
  ...realServer,
  after: (work: Promise<unknown>) => {
    retained.push(work);
  },
}));
const { ProLedger } = await import("~/server/pro/ledger");
const { ProTextOperation } = await import("~/server/pro/operation");
const { ProChat } = await import("~/server/pro/chat");
const { createProChatTransport } = await import("~/server/pro/chat-provider");

const client = createClient({ url: ":memory:" });
for (const migration of [
  "0015_private_pro.sql",
  "0016_pro_billing_events.sql",
  "0029_sandbox_billing.sql",
  "0030_apple_sandbox.sql",
])
  await client.executeMultiple(
    (
      await Bun.file(
        new URL(
          `../../../../../../../packages/drizzle/drizzle/${migration}`,
          import.meta.url,
        ),
      ).text()
    ).replaceAll("--> statement-breakpoint", ""),
  );
const ledger = new ProLedger(client, {
  ownerAccountIds: ["route-owner"],
  supplierBooks: supplierFixture,
  now: () => 1500,
});
let providerRequests = 0;
const chat = new ProChat(
  ledger,
  new ProTextOperation(
    ledger,
    createProChatTransport({
      authorize: ({ operationId, attemptId, accountId }) =>
        ledger.authorizeDispatch(operationId, attemptId, accountId),
      resolveServerKey: () => "synthetic-only",
      fetch: async () => {
        providerRequests++;
        return new Response(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Done." })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "route-test", status: "completed", usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 4 } } })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    }),
  ),
);
mock.module("~/server/pro/chat-runtime", () => ({
  PRO_CHAT_AVAILABLE: true,
  PRO_CHAT_UNAVAILABLE: "",
  proChat: () => chat,
}));
const { POST } = await import("./route");

const ALICE = "route_chat_alice";
const BOB = "route_chat_bob";
const READ_TOKEN = "lxd_route_chat_read";
const WRITE_TOKEN = "lxd_route_chat_write";
const BOB_TOKEN = "lxd_route_chat_bob";
const input = { prompt: "Hello" };
await db.insert(schema.users).values(
  [ALICE, BOB].map((id) => ({
    id,
    name: id,
    email: `${id}@example.test`,
    config: { aiPower: { mode: "pro" as const } },
  })),
);
await db.insert(schema.apiTokens).values([
  {
    id: "route_chat_read",
    userId: ALICE,
    name: "read",
    tokenHash: hashApiToken(READ_TOKEN),
    scope: "read" as const,
  },
  {
    id: "route_chat_write",
    userId: ALICE,
    name: "write",
    tokenHash: hashApiToken(WRITE_TOKEN),
    scope: "write" as const,
  },
  {
    id: "route_chat_bob",
    userId: BOB,
    name: "bob",
    tokenHash: hashApiToken(BOB_TOKEN),
    scope: "write" as const,
  },
]);
for (const account of [ALICE, BOB]) {
  await ledger.grantEligibility("route-owner", account, "tester");
  await ledger.grantPeriod("route-owner", {
    accountId: account,
    eventId: `route-${account}`,
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 10000000,
    reason: "trial",
    environment: "test",
  });
}
async function accepted(account: string, key: string) {
  return chat.accept(account, key, input, await chat.quote(account, input));
}
function stream(id: string, authorization?: string) {
  return POST(
    new Request("https://app.test/api/chat/stream", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify({ id, input }),
    }) as never,
  );
}
afterAll(() => client.close());

test("a read-scope API token cannot start paid chat dispatch", async () => {
  cookieAccount = null;
  const before = providerRequests;
  const operation = await accepted(ALICE, "read-scope");
  const response = await stream(operation.id, `Bearer ${READ_TOKEN}`);
  expect(response.status).toBe(401);
  await Promise.all(retained);
  expect(providerRequests).toBe(before);
  expect((await ledger.operation(ALICE, operation.id)).state).toBe("reserved");
});

test("a write-scope token and the cookie session each stream their own accepted operation", async () => {
  cookieAccount = null;
  const before = providerRequests;
  const viaToken = await accepted(ALICE, "write-scope");
  const tokenResponse = await stream(viaToken.id, `Bearer ${WRITE_TOKEN}`);
  expect(tokenResponse.status).toBe(200);
  expect(await tokenResponse.text()).toContain('"state":"settled"');
  cookieAccount = ALICE;
  const viaCookie = await accepted(ALICE, "cookie-session");
  const cookieResponse = await stream(viaCookie.id);
  expect(cookieResponse.status).toBe(200);
  expect(await cookieResponse.text()).toContain('"state":"settled"');
  await Promise.all(retained);
  expect(providerRequests).toBe(before + 2);
});

test("another account's operation and malformed authorization never reach the provider", async () => {
  cookieAccount = null;
  const before = providerRequests;
  const operation = await accepted(ALICE, "foreign");
  const foreign = await stream(operation.id, `Bearer ${BOB_TOKEN}`);
  expect(foreign.ok).toBe(false);
  cookieAccount = ALICE;
  const malformed = await stream(operation.id, "Bearer not-an-api-token");
  expect(malformed.status).toBe(401);
  await Promise.all(retained);
  expect(providerRequests).toBe(before);
  expect((await ledger.operation(ALICE, operation.id)).state).toBe("reserved");
});

test("D2 authenticated escaped selected input streams intact and actual envelope overflow never dispatches", async () => {
  cookieAccount = null;
  const selected = { prompt: "\u0000".repeat(1000) };
  const op = await chat.accept(
    BOB,
    "d2-escaped",
    selected,
    await chat.quote(BOB, selected),
  );
  const before = providerRequests;
  const body = JSON.stringify({ id: op.id, input: selected });
  expect(new TextEncoder().encode(body).length).toBeGreaterThan(4096);
  const response = await POST(
    new Request("https://app.test/api/chat/stream", {
      method: "POST",
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
      body,
    }) as never,
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"state":"settled"');
  expect(providerRequests).toBe(before + 1);
  const overflow = await POST(
    new Request("https://app.test/api/chat/stream", {
      method: "POST",
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
      body: " ".repeat(16385),
    }) as never,
  );
  expect(overflow.status).toBe(413);
  expect(providerRequests).toBe(before + 1);
});
