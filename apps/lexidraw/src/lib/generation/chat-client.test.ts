import { expect, test } from "bun:test";
import { proChatPort } from "./chat-client";
import { CHAT_STOP, runChat } from "./chat";
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
          controller.abort(CHAT_STOP);
          throw new Error("lost response with private diagnostic");
        }
        return operation;
      },
      recover: async (request) => {
        keys.push(request.idempotencyKey);
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

test("lost acceptance after detach recovers the owned identity by read without a second acceptance or stream", async () => {
  const controller = new AbortController();
  let accepts = 0,
    reads = 0,
    streams = 0;
  const input = { prompt: "Hello" };
  const operation = Operation.parse({
    id: "owned",
    account_id: "alice",
    period_id: "period",
    idempotency_key: "retained",
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
      accept: async () => {
        accepts++;
        controller.abort();
        throw Error("Lost accepted reply");
      },
      recover: async (request: { idempotencyKey: string }) => {
        reads++;
        expect(request.idempotencyKey).toBe("retained");
        return operation;
      },
      cancel: async () => {
        throw Error("Detach cannot cancel");
      },
      fetch: async () => {
        streams++;
        return new Response();
      },
      origin: "https://app.test",
      idempotencyKey: "retained",
    }),
    { signal: controller.signal },
  );
  await expect(running).rejects.toThrow("connection closed");
  expect(accepts).toBe(1);
  expect(reads).toBe(1);
  expect(streams).toBe(0);
});

test("lost submission retains original input and key; a later request performs only an owned read", async () => {
  const { OwnedChatSubmission } = await import("./chat-client");
  const submission = new OwnedChatSubmission();
  const original = { prompt: "Original" };
  submission.submitted("retained", original);
  let reads = 0;
  await expect(
    submission.beforeNewTurn(async (request) => {
      reads++;
      expect(request).toEqual({ idempotencyKey: "retained", input: original });
      throw Error("Read unavailable");
    }),
  ).rejects.toThrow();
  await expect(
    submission.beforeNewTurn(async (request) => {
      reads++;
      expect(request.idempotencyKey).toBe("retained");
      return Operation.parse({
        id: "owned",
        account_id: "alice",
        period_id: "period",
        idempotency_key: "retained",
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
    }),
  ).rejects.toThrow("owned chat");
  expect(reads).toBe(2);
});
