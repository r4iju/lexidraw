import { expect, test } from "bun:test";
import { createByokSession } from "../byok/session";
import { DeviceNarration } from "./device-flow";

test("completed local chunks survive removal and reopening; resume needs a fresh key and sync retry never regenerates", async () => {
  let calls = 0,
    failed = true;
  const session = createByokSession(
    async () => {
      calls++;
      if (calls === 1) session.remove();
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  const disk = new Map<string, string>();
  const ports = {
    account: () => "alice",
    available: () => true,
    byok: session,
    store: {
      load: async (scope: string) => disk.get(scope) ?? null,
      save: async (scope: string, data: string, expected: string | null) => {
        if ((disk.get(scope) ?? null) !== expected) return false;
        disk.set(scope, data);
        return true;
      },
      clear: async (scope: string) => {
        disk.delete(scope);
      },
    },
    sync: async () => {
      if (failed) throw new Error("storage outage");
      return "saved";
    },
  };
  session.replace("openrouter", "sk-or-v1-FIRST-NARRATION-ONLY");
  const first = new DeviceNarration("alice", "doc", ports);
  await first.start("a".repeat(501));
  expect(
    first.state()?.parts.filter((p) => p.kind === "completed"),
  ).toHaveLength(1);
  expect(calls).toBe(1);
  const reopened = new DeviceNarration("alice", "doc", ports);
  await reopened.restore();
  await reopened.resume();
  expect(calls).toBe(1);
  session.replace("openrouter", "sk-or-v1-SECOND-NARRATION-ONLY");
  await reopened.resume();
  expect(calls).toBe(2);
  session.remove();
  await reopened.sync();
  expect(reopened.state()?.status).toBe("sync_failed");
  failed = false;
  await reopened.sync();
  expect(reopened.state()?.status).toBe("saved");
  expect(calls).toBe(2);
  expect(Array.from(disk.values()).join()).not.toContain("sk-or-v1");
});

test("interrupted provider outcomes survive restart without replay and recovered metadata cannot leak a retired opaque key", async () => {
  let calls = 0;
  const disk = new Map<string, string>();
  const network = async () => {
    calls++;
    throw new Error("connection lost after dispatch");
  };
  const session = createByokSession(network, "https://app.test", {
    narrationFixture: true,
  });
  const opaque = "opaque-device-secret-286";
  session.replace("openrouter", opaque);
  const store = {
    load: async (s: string) => disk.get(s) ?? null,
    save: async (s: string, d: string, expected: string | null) => {
      if ((disk.get(s) ?? null) !== expected) return false;
      disk.set(s, d);
      return true;
    },
    clear: async (s: string) => {
      disk.delete(s);
    },
  };
  const flow = new DeviceNarration("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok: session,
    store,
    sync: async () => "saved",
  });
  await flow.start("A page.");
  expect(flow.state()?.status).toBe("unknown");
  const newSession = createByokSession(network, "https://app.test", {
    narrationFixture: true,
  });
  newSession.replace("openrouter", "another-opaque-device-secret");
  const recovered = new DeviceNarration("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok: newSession,
    store,
    sync: async () => "saved",
  });
  await recovered.restore();
  await recovered.resume();
  expect(calls).toBe(1);
  const scope = JSON.stringify(["alice", "doc"]),
    value = JSON.parse(disk.get(scope) ?? "{}");
  value.parts[0].text = btoa(encodeURIComponent(opaque));
  disk.set(scope, JSON.stringify(value));
  await expect(recovered.restore()).rejects.toThrow(
    "Credential egress blocked",
  );
});

test("expired sync authorization rotates only upload identity and does not regenerate completed audio", async () => {
  const ids: string[] = [];
  let calls = 0;
  let disk: string | null = null;
  const byok = createByokSession(
    async () => {
      calls++;
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", "opaque-expiry-narration-key");
  const flow = new DeviceNarration("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => disk,
      save: async (_s: string, d: string, e: string | null) => {
        if (e !== disk) return false;
        disk = d;
        return true;
      },
      clear: async () => {
        disk = null;
      },
    },
    sync: async (id) => {
      ids.push(id);
      if (ids.length === 1)
        throw new Error("Upload expired. Retry retained audio.");
      return "saved";
    },
  });
  await flow.start("Hello");
  byok.remove();
  await flow.sync();
  await flow.sync();
  expect(ids[0]).not.toBe(ids[1]);
  expect(calls).toBe(1);
  expect(flow.state()?.status).toBe("saved");
});

test("two device controllers cannot race local job creation into duplicate provider billing", async () => {
  let calls = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const byok = createByokSession(
    async () => {
      calls++;
      await gate;
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", "opaque-concurrent-narration-key");
  let disk: string | null = null;
  const ports = {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => disk,
      save: async (_s: string, data: string, expected?: string | null) => {
        if (expected !== undefined && expected !== disk) return false;
        disk = data;
        return true;
      },
      clear: async () => {
        disk = null;
      },
    },
    sync: async () => "saved",
  };
  const first = new DeviceNarration("alice", "doc", ports),
    second = new DeviceNarration("alice", "doc", ports);
  const starting = Promise.allSettled([
    first.start("Hello"),
    second.start("Hello"),
  ]);
  await Bun.sleep(25);
  try {
    expect(calls).toBe(1);
  } finally {
    release();
    await starting;
  }
});

test("confirmed late output resolves its original local fence even when another controller restored uncertainty", async () => {
  let calls = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const byok = createByokSession(
    async () => {
      calls++;
      await gate;
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", "opaque-late-narration-key");
  let disk: string | null = null;
  const ports = {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => disk,
      save: async (_s: string, d: string, e: string | null) => {
        if (e !== disk) return false;
        disk = d;
        return true;
      },
      clear: async () => {
        disk = null;
      },
    },
    sync: async () => "saved",
  };
  const first = new DeviceNarration("alice", "doc", ports),
    second = new DeviceNarration("alice", "doc", ports);
  const running = first.start("Hello");
  while (calls === 0) await Bun.sleep(1);
  await second.restore();
  release();
  await running;
  const third = new DeviceNarration("alice", "doc", ports);
  await third.restore();
  expect(third.state()?.parts[0]?.kind).toBe("completed");
  expect(calls).toBe(1);
});

test("restored jobs cannot enlarge the bounded document before device dispatch", async () => {
  let calls = 0;
  const byok = createByokSession(
    async () => {
      calls++;
      throw new Error("unexpected");
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", "opaque-input-bound-narration-key");
  let data = JSON.stringify({
    version: 1,
    fingerprints: byok.fingerprints(),
    account: "alice",
    documentId: "doc",
    id: "tampered",
    created: Date.now(),
    status: "paused",
    parts: Array.from({ length: 8 }, () => ({
      kind: "pending",
      text: "😀".repeat(500),
    })),
  });
  const flow = new DeviceNarration("alice", "doc", {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async () => data,
      save: async (_s: string, d: string) => {
        data = d;
        return true;
      },
      clear: async () => {},
    },
    sync: async () => "saved",
  });
  await expect(flow.restore()).rejects.toThrow();
  expect(calls).toBe(0);
});

test("account change clears old local scope and blocks generation and sync on the old controller", async () => {
  let account: string | undefined = "alice",
    disk: string | null = null,
    calls = 0,
    syncs = 0;
  const byok = createByokSession(
    async () => {
      calls++;
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", "opaque-account-scope-key");
  const flow = new DeviceNarration("alice", "doc", {
    account: () => account,
    available: () => true,
    byok,
    store: {
      load: async () => disk,
      save: async (_s: string, d: string, e: string | null) => {
        if (disk !== e) return false;
        disk = d;
        return true;
      },
      clear: async () => {
        disk = null;
      },
    },
    sync: async () => {
      syncs++;
      return "saved";
    },
  });
  await flow.start("Hello");
  account = "bob";
  await expect(flow.sync()).rejects.toThrow("Account session ended");
  expect(flow.state() === null).toBe(true);
  expect(disk).toBeNull();
  expect(calls).toBe(1);
  expect(syncs).toBe(0);
});
