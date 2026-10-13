import { expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";
let signedIn = true;
let databaseReads = 0;
mock.module("~/server/auth", () => ({
  auth: async () => (signedIn ? { user: { id: "synthetic-agent" } } : null),
}));
const refuseDatabase = () => {
  databaseReads++;
  throw new Error("Retired endpoint must not read document ACL");
};
mock.module("@packages/drizzle", () => ({
  drizzle: { select: refuseDatabase },
  schema: { entities: {}, sharedEntities: {} },
  and: refuseDatabase,
  eq: refuseDatabase,
  isNull: refuseDatabase,
  or: refuseDatabase,
  ne: refuseDatabase,
}));
const { POST } = await import("./route");
const invoke: (request: NextRequest) => Promise<Response> = POST;

test("retired agent POST is terminal without pulling malformed, empty, oversized or deferred bodies or reading ACL", async () => {
  for (const body of ["{", "", "x".repeat(100_000), null]) {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          if (body === null)
            controller.error(new Error("Streaming body consumed"));
          else {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          }
        },
      },
      { highWaterMark: 0 },
    );
    // Native Request provides the route's public JSON/stream boundary; Next adds no body behavior needed here.
    const request = new Request("http://localhost/api/llm/agent", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit) as NextRequest;
    const response = await invoke(request);
    expect(response.status).toBe(410);
    expect(await response.text()).toContain("bounded");
    expect(pulls).toBe(0);
    expect(request.bodyUsed).toBe(false);
  }
  expect(databaseReads).toBe(0);
  signedIn = false;
  // Closed sibling routes retain authentication-only 401 compatibility.
  expect(
    (
      await invoke(
        new Request("http://localhost/api/llm/agent", {
          method: "POST",
        }) as NextRequest,
      )
    ).status,
  ).toBe(401);
});
