import { expect, test } from "bun:test";
const { createAppleSandboxStatusAPI } = await import("./apple-transport");
test("Apple status reads use only sandbox GET paths, reject redirects and cap body bytes before parsing", async () => {
  const requests: Request[] = [];
  const api = createAppleSandboxStatusAPI({
    token: () => "synthetic-jwt",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return Response.json({ signedTransactionInfo: "fixture" });
      },
      { preconnect() {} },
    ),
  });
  expect(await api.getTransactionInfo("123")).toEqual({
    signedTransactionInfo: "fixture",
  });
  expect(requests[0]?.url).toBe(
    "https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/123",
  );
  expect(requests[0]?.redirect).toBe("error");
  expect(requests[0]?.method).toBe("GET");
  await expect(api.getTransactionInfo("../bad")).rejects.toThrow("rejected");
  expect(requests).toHaveLength(1);
  const oversized = createAppleSandboxStatusAPI({
    token: () => "synthetic-jwt",
    fetch: Object.assign(async () => new Response("x".repeat(1048577)), {
      preconnect() {},
    }),
  });
  await expect(oversized.getAllSubscriptionStatuses("123")).rejects.toThrow(
    "rejected",
  );
});
test("Apple status response headers and body share one abortable deadline", async () => {
  const api = createAppleSandboxStatusAPI({
    token: () => "synthetic-jwt",
    timeoutMs: 20,
    fetch: Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new Error("aborted")),
              );
            },
          }),
        ),
      { preconnect() {} },
    ),
  });
  await expect(api.getTransactionInfo("123")).rejects.toThrow("rejected");
});
