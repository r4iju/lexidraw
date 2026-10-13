import { test, expect } from "bun:test";
import { createByokSession } from "../byok/session";
import { DeviceAgent } from "./device-flow";

test("device planning and decisions call only OpenRouter; ordinary edit is key-free and never debits Pro", async () => {
  const requests: Request[] = [];
  const answers = [
    { edits: ["Add a paragraph"] },
    { kind: "append", text: "Saved on device" },
    { kind: "done" },
  ];
  const byok = createByokSession(
    async (request) => {
      requests.push(request);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(answers.shift()) } }],
      });
    },
    "https://app.invalid",
    { agentFixture: true },
  );
  byok.replace("openrouter", "opaque-device-test-secret-288");
  let stored: string | null = null;
  const writes: unknown[] = [];
  const flow = new DeviceAgent("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => stored,
      save: async (_, data, expected) => {
        if (stored !== expected) return false;
        stored = data;
        return true;
      },
      clear: async () => {
        stored = null;
      },
    },
    read: async () => ({ revision: 1, text: "Existing" }),
    apply: async (data) => {
      byok.assertEgress(JSON.stringify(data));
      writes.push(data);
      return { revision: 2, description: "Saved on device" };
    },
  });
  await flow.start("Add a paragraph");
  expect(flow.state()?.status).toBe("complete");
  expect(flow.state()?.receipts).toEqual([
    { revision: 2, description: "Saved on device" },
  ]);
  expect(writes).toEqual([
    {
      accountId: "alice",
      documentId: "doc",
      idempotencyKey: `${flow.state()?.id}:0`,
      revision: 1,
      edit: { kind: "append", text: "Saved on device" },
    },
  ]);
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request.redirect).toBe("error");
    // Bun 1.3 reports include for Request.credentials; the real browser journey verifies omit.
    expect(request.headers.get("Authorization")).toBe(
      "Bearer opaque-device-test-secret-288",
    );
    const body = await request.json();
    expect(body.model).toBe("openai/gpt-4.1-mini");
    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty("tools");
  }
  expect(stored).not.toContain("opaque-device-test-secret-288");
});

test("production device agent transport cannot be enabled by key presence", async () => {
  let calls = 0;
  const byok = createByokSession(async () => {
    calls++;
    return Response.json({
      choices: [{ message: { content: '{"edits":["add"]}' } }],
    });
  }, "https://app.invalid");
  const reference = byok.replace("openrouter", "opaque-production-gate-288");
  const { deviceAgentStart, deviceAgentFence } = await import("./device-core");
  const state = deviceAgentFence(
    deviceAgentStart("a", "d", "one", Date.now(), "add", {
      revision: 1,
      text: "",
    }),
    Date.now(),
  );
  await expect(byok.agent(reference, state)).rejects.toThrow("await");
  expect(calls).toBe(0);
});

function harness(
  answers: unknown[] = [
    { edits: ["add"] },
    { kind: "append", text: "Retained" },
    { kind: "done" },
  ],
) {
  let account: string | undefined = "alice",
    stored: string | null = null,
    calls = 0,
    writes = 0;
  let yieldSave: (() => void) | undefined;
  const byok = createByokSession(
    async () => {
      calls++;
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return Response.json({
        choices: [
          {
            message: {
              content:
                typeof answer === "string" ? answer : JSON.stringify(answer),
            },
          },
        ],
      });
    },
    "https://app.invalid",
    { agentFixture: true },
  );
  byok.replace("openrouter", "opaque-retired-device-key-288");
  const ports = {
    account: () => account,
    available: () => true,
    byok,
    store: {
      load: async () => stored,
      save: async (_: string, data: string, expected: string | null) => {
        if (stored !== expected) return false;
        stored = data;
        yieldSave?.();
        return true;
      },
      clear: async () => {
        stored = null;
      },
    },
    read: async () => ({ revision: 1, text: "Existing" }),
    apply: async (_input: import("./device-core").DeviceMutation) => {
      writes++;
      return { revision: 2, description: "Retained" };
    },
  };
  return {
    byok,
    ports,
    flow: () => new DeviceAgent("alice", "doc", ports),
    count: () => ({ calls, writes }),
    data: () => stored,
    saveYield: (fn: () => void) => {
      yieldSave = fn;
    },
    switchAccount: () => {
      account = "bob";
    },
  };
}
test("unknown request never repeats on restore and retired encoded echo is blocked", async () => {
  const h = harness([new Error("lost response")]);
  const flow = h.flow();
  await flow.start("add");
  expect(flow.state()?.status).toBe("unknown");
  const restored = h.flow();
  await restored.restore();
  await restored.resume();
  expect(h.count()).toEqual({ calls: 1, writes: 0 });
  h.byok.remove();
  expect(() =>
    h.byok.assertEgress(btoa("opaque-retired-device-key-288")),
  ).toThrow();
});
test("removal during paid fence persistence prevents dispatch; logout during persistence clears scope", async () => {
  const h = harness();
  h.saveYield(() => {
    if (h.data()?.includes('"kind":"started"')) h.byok.remove();
  });
  const flow = h.flow();
  await flow.start("add");
  expect(h.count().calls).toBe(0);
  expect(flow.state()?.status).toBe("paused");
  const switched = harness();
  switched.saveYield(() => switched.switchAccount());
  await expect(switched.flow().start("add")).rejects.toThrow("session ended");
  expect(switched.data()).toBeNull();
  expect(switched.count().calls).toBe(0);
});
test("retained edit retries keyless with same identity and reports saved receipt without restarting planning", async () => {
  const h = harness();
  let first = true;
  const identities: string[] = [];
  h.ports.apply = async (input) => {
    identities.push(input.idempotencyKey);
    if (first) {
      first = false;
      throw new Error("lost receipt");
    }
    return { revision: 2, description: "Retained" };
  };
  const flow = h.flow();
  await flow.start("add");
  expect(flow.state()?.status).toBe("sync_failed");
  h.byok.remove();
  const restored = h.flow();
  await restored.restore();
  await restored.resume();
  expect(restored.state()?.receipts).toHaveLength(1);
  expect(restored.state()?.status).toBe("paused");
  expect(identities[0]).toBe(identities[1]);
  expect(h.count().calls).toBe(2);
});
test("tampered restored paid input hash fails closed and provider credential echoes are never persisted", async () => {
  const h = harness([new Error("unknown")]);
  await h.flow().start("add");
  const { deviceAgentRestore } = await import("./device-core");
  const saved = JSON.parse(h.data() ?? "null");
  expect(() => deviceAgentRestore({ ...saved, prompt: "Changed" })).toThrow(
    "input changed",
  );
  const echo = harness([btoa("opaque-retired-device-key-288")]);
  const flow = echo.flow();
  await flow.start("add");
  expect(flow.state()?.status).toBe("unknown");
  expect(echo.data()).not.toContain(btoa("opaque-retired-device-key-288"));
});

test("late logout cleanup cannot delete a newer checkpoint in the same account scope", async () => {
  let stored: string | null = null;
  let release: (() => void) | undefined;
  let fenced: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    fenced = resolve;
  });
  const byok = createByokSession(
    async () => {
      throw new Error("Must not dispatch");
    },
    "https://app.invalid",
    { agentFixture: true },
  );
  byok.replace("openrouter", "opaque-late-checkpoint-288");
  const flow = new DeviceAgent("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => stored,
      save: async (_, data, expected) => {
        if (stored !== expected) return false;
        stored = data;
        if (data.includes('"kind":"started"')) {
          fenced?.();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return true;
      },
      clear: async (_, expected) => {
        if (expected === undefined || expected === stored) stored = null;
      },
    },
    read: async () => ({ revision: 1, text: "" }),
    apply: async () => ({ revision: 2, description: "never" }),
  });
  const running = flow.start("add");
  await reached;
  await flow.end();
  stored = "new account-session checkpoint";
  release?.();
  await expect(running).rejects.toThrow();
  expect(stored).toBe("new account-session checkpoint");
});

test("restored retained edit cannot change account, document, revision or mutation identity", async () => {
  const h = harness();
  h.ports.apply = async () => {
    throw new Error("retain");
  };
  await h.flow().start("add");
  const { deviceAgentRestore } = await import("./device-core");
  const saved = JSON.parse(h.data() ?? "null");
  for (const pending of [
    { ...saved.pending, accountId: "bob" },
    { ...saved.pending, documentId: "other" },
    { ...saved.pending, revision: 999 },
    { ...saved.pending, idempotencyKey: "new identity" },
  ])
    expect(() => deviceAgentRestore({ ...saved, pending })).toThrow();
});

test("logout and signing back into the same account invalidates the old controller", async () => {
  const h = harness();
  let generation = 1;
  const flow = new DeviceAgent("alice", "doc", {
    ...h.ports,
    session: () => generation,
  });
  generation = 2;
  await expect(flow.start("stale action")).rejects.toThrow("session ended");
  expect(h.count().calls).toBe(0);
});

test("only an explicit new completed action gets a new identity; unknown paid work cannot be reset", async () => {
  const h = harness([
    { edits: ["add"] },
    { kind: "append", text: "Retained" },
    { kind: "done" },
    { edits: ["add"] },
    { kind: "append", text: "Retained" },
    { kind: "done" },
  ]);
  const flow = h.flow();
  await flow.start("first");
  const original = flow.state()?.id;
  await flow.newAction();
  expect(h.count().calls).toBe(3);
  await flow.start("second");
  expect(flow.state()?.id).not.toBe(original);
  expect(h.count().calls).toBe(6);
  const uncertain = harness([new Error("unknown")]);
  const held = uncertain.flow();
  await held.start("add");
  await held.newAction();
  expect(held.state()?.status).toBe("unknown");
  expect(uncertain.count().calls).toBe(1);
});

test("a second start during document loading cannot replace the first action or repeat planning", async () => {
  const h = harness();
  let reads = 0,
    release = () => {};
  h.ports.read = async () => {
    if (++reads === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return { revision: 1, text: "Existing" };
  };
  const flow = h.flow();
  const first = flow.start("first"),
    second = flow.start("second");
  await first;
  const id = flow.state()?.id;
  release();
  await second;
  expect(flow.state()?.id).toBe(id);
  expect(flow.state()?.status).toBe("complete");
  expect(h.count()).toEqual({ calls: 3, writes: 1 });
  expect(reads).toBe(1);
});

test("image paid fences hash the complete fixed provider request", async () => {
  const {
    deviceAgentStart,
    deviceAgentFence,
    deviceAgentOutput,
    deviceAgentHash,
  } = await import("./device-core");
  const { imageRequest } = await import("../images/format");
  const initial = deviceAgentStart(
    "alice",
    "doc",
    "image-bound",
    Date.now(),
    "Draw a tree",
    { revision: 1, text: "" },
  );
  const planned = deviceAgentOutput(
    deviceAgentFence(initial, Date.now()),
    JSON.stringify({ edits: ["Add tree"] }),
  );
  const image = deviceAgentOutput(
    deviceAgentFence(planned, Date.now()),
    JSON.stringify({ kind: "image", prompt: "A tree" }),
  );
  expect(deviceAgentFence(image, Date.now()).fence?.hash).toBe(
    deviceAgentHash(imageRequest("A tree")),
  );
});

test("restoring an unknown request requires an unknown fence and a phase-specific payload", async () => {
  const {
    deviceAgentStart,
    deviceAgentRestore,
    deviceAgentHash,
    deviceAgentRequest,
  } = await import("./device-core");
  const started = deviceAgentStart("alice", "doc", "scoped", 1000, "Add", {
    revision: 1,
    text: "Original",
  });
  expect(() =>
    deviceAgentRestore({
      ...started,
      status: "unknown",
      fence: {
        kind: "started",
        hash: deviceAgentHash(deviceAgentRequest(started)),
      },
    }),
  ).toThrow();
  expect(() => deviceAgentRestore({ ...started, phase: "image" })).toThrow();
  expect(() => deviceAgentRestore({ ...started, phase: "mutation" })).toThrow();
});

for (const boundary of ["read", "save"] as const)
  test(`Stop during ${boundary} admission does not dispatch until explicit resume`, async () => {
    const h = harness();
    let reached = () => {},
      release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const waiting = new Promise<void>((r) => {
      reached = r;
    });
    if (boundary === "read")
      h.ports.read = async () => {
        reached();
        await gate;
        return { revision: 1, text: "Existing" };
      };
    else {
      const save = h.ports.store.save;
      let first = true;
      h.ports.store.save = async (...args) => {
        const result = await save(...args);
        if (first) {
          first = false;
          reached();
          await gate;
        }
        return result;
      };
    }
    const flow = h.flow(),
      running = flow.start("Add paragraph");
    await waiting;
    flow.stop();
    release();
    await running;
    expect(h.count()).toEqual({ calls: 0, writes: 0 });
    if (flow.state()) {
      await flow.resume();
      expect(h.count()).toEqual({ calls: 3, writes: 1 });
    } else {
      await flow.start("Add paragraph");
      expect(h.count()).toEqual({ calls: 3, writes: 1 });
    }
  });
