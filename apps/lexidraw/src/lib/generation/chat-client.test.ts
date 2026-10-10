import { expect, test } from "bun:test";
import { proChatPort } from "./chat-client";
import { runChat } from "./chat";
import { PRICEBOOK, Operation } from "~/server/pro/contracts";
test("lost acceptance response recovers only the same reservation and cancellation never dispatches a paid stream", async () => {
  const controller = new AbortController();
  const keys: string[] = [];
  const cancelled: string[] = [];
  let network = 0;
  const input = { prompt: "Hello" };
  const operation = Operation.parse({
    id: "chat",
    account_id: "alice",
    period_id: "period",
    idempotency_key: "same-turn",
    input_hash: "hash",
    feature: "chat",
    state: "reserved",
    quote: 1792000,
    charged: 0,
    pricebook: JSON.stringify(PRICEBOOK),
    policy: "fixture",
    result: null,
    cancel_requested: 0,
    created_at: 1000,
  });
  const running = runChat(
    input,
    proChatPort(input, {
      quote: async () => ({
        periodId: "period",
        maximum: 1792000,
        book: PRICEBOOK,
        inputHash: "hash",
        policy: "fixture",
      }),
      confirm: async () => true,
      accept: async (request) => {
        keys.push(request.idempotencyKey);
        if (keys.length === 1) {
          controller.abort();
          throw new Error("lost response with private diagnostic");
        }
        return operation;
      },
      cancel: async (id) => {
        cancelled.push(id);
      },
      fetch: async () => {
        network++;
        return new Response();
      },
      origin: "https://app.test",
      idempotencyKey: "same-turn",
    }),
    { signal: controller.signal },
  );
  await expect(running).rejects.toThrow("Chat stopped");
  expect(keys).toEqual(["same-turn", "same-turn"]);
  expect(cancelled).toEqual(["chat"]);
  expect(network).toBe(0);
});
