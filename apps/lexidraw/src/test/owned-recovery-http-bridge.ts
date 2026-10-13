/** Local acceptance bridge: real bearer authentication, Pro router and file ledger; synthetic provider only. */
import { mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "./server-runtime";
import { supplierFixture } from "./supplier-fixture";
import { ProLedger } from "~/server/pro/ledger";
import { ProTextOperation } from "~/server/pro/operation";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
mock.module("~/server/auth", () => ({ authEffective: async () => null }));
const db = await installServerRuntime();
const { createTRPCContext, createTRPCRouter, protectedProcedure } =
  await import("~/server/api/trpc");
const { hashApiToken } = await import("~/server/auth/api-token-format");
const { createProRouter } = await import("~/server/api/routers/pro");
const { configRouter } = await import("~/server/api/routers/config");
const token = "lxd_291_owned_recovery_local_synthetic";
await db
  .insert(schema.users)
  .values({
    id: "bridge-reader",
    name: "Reader",
    email: "recovery-bridge@example.test",
    config: { aiPower: { mode: "pro" }, autocomplete: { enabled: true } },
  });
await db
  .insert(schema.apiTokens)
  .values({
    userId: "bridge-reader",
    name: "Local native acceptance",
    scope: "write",
    tokenHash: hashApiToken(token),
    expiresAt: null,
  });
const file = process.argv[2] ?? join(tmpdir(), `lexidraw-owned-recovery-${randomUUID()}.sqlite`);
if (await Bun.file(file).exists())
  throw Error("Use a fresh task-owned ledger path; do not overwrite evidence");
const client = createClient({ url: `file:${file}` });
for (const migration of [
  "0015_private_pro",
  "0016_pro_billing_events",
  "0029_sandbox_billing",
  "0030_apple_sandbox",
  "0031_pro_chat_recovery",
]) {
  await client.executeMultiple(
    (
      await Bun.file(
        new URL(
          `../../../../packages/drizzle/drizzle/${migration}.sql`,
          import.meta.url,
        ),
      ).text()
    ).replaceAll("--> statement-breakpoint", ""),
  );
}
const ledger = new ProLedger(client, {
  ownerAccountIds: ["owner"],
  now: () => 1000,
  supplierBooks: supplierFixture,
});
await ledger.grantEligibility(
  "owner",
  "bridge-reader",
  "Local deterministic acceptance",
);
await ledger.grantPeriod("owner", {
  accountId: "bridge-reader",
  eventId: "bridge-period",
  startsAt: 1000,
  endsAt: 2000,
  subcredits: 10_000_000,
  reason: "Local deterministic acceptance",
  environment: "test",
});
let providerCalls = 0;
const executor = new ProTextOperation(ledger, async () => {
  providerCalls++;
  await Bun.sleep(300);
  return {
    kind: "completed",
    completion: {
      text: " paid output",
      usage: { input: 100, cachedInput: 0, output: 4 },
      actualCostNanoUsd: 93000,
    },
  };
});
const active = new Set<Promise<unknown>>();
const router = createTRPCRouter({
  config: configRouter,
  auth: createTRPCRouter({
    getPowerPreference: protectedProcedure.query(() => ({
      mode: "pro" as const,
    })),
  }),
  pro: createProRouter({
    ledger: () => ledger,
    dispatch: async (id, text, account) => {
      const work = executor
        .execute(account, id, text)
        .finally(() => active.delete(work));
      active.add(work);
    },
  }),
  recoveryFixture: createTRPCRouter({
    evidence: protectedProcedure.query(async ({ ctx }) => ({
      providerCalls,
      status: await ledger.status(ctx.session.user.id),
    })),
  }),
});
globalThis.fetch = Object.assign(
  async () => {
    throw Error("External network forbidden in local acceptance bridge");
  },
  { preconnect() {} },
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3091,
  fetch: (req) => {
    if (!new URL(req.url).pathname.startsWith("/api/trpc/"))
      return new Response("Not found", { status: 404 });
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router,
      createContext: () => createTRPCContext({ headers: req.headers }),
    });
  },
});
console.log(
  JSON.stringify({
    ready: true,
    origin: "http://127.0.0.1:3091",
    ledger: file,
    authentication: "production bearer resolver",
    provider: "deterministic injected adapter",
  }),
);
process.on("SIGTERM", () => {
  server.stop();
  client.close();
  process.exit(0);
});
