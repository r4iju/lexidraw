import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceNarrationView } from "./device-view";
import { audioFromPCM } from "./portable";
test("actual device narration view shows held uncertainty, foreground limits and keyless completed sync/playback", () => {
  const state = {
    version: 1 as const,
    fingerprints: [],
    account: "alice",
    documentId: "doc",
    id: "local",
    created: 1000,
    status: "unknown" as const,
    parts: [{ kind: "unknown" as const, text: "Hello" }],
  };
  const props = {
    available: true,
    keyAvailable: true,
    onStart: () => {},
    onResume: () => {},
    onSync: () => {},
  };
  const unknown = renderToStaticMarkup(
    <DeviceNarrationView {...props} checkpoint={state} />,
  );
  expect(unknown).toContain("may still be billed");
  expect(unknown).toContain("Suspension or shutdown");
  expect(unknown).not.toContain("Resume generation");
  const completed = renderToStaticMarkup(
    <DeviceNarrationView
      {...props}
      keyAvailable={false}
      checkpoint={{
        ...state,
        status: "sync_failed",
        parts: [
          {
            kind: "completed",
            text: "Hello",
            ...audioFromPCM(new Uint8Array(48000), () => {}),
          },
        ],
      }}
    />,
  );
  expect(completed).toContain("Retry sync");
  expect(completed).toContain("controls=");
  expect(completed).not.toContain("Resume generation");
});

test("E1 Controller Resume shows a renewed bounded continuation and retained playback", async () => {
  const { JSDOM } = await import("jsdom");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { spyOn } = await import("bun:test");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://app.test",
  });
  const globals = globalThis as Record<string, unknown>; // DOM test boundary, restored after unmount.
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const clock = spyOn(Date, "now").mockReturnValue(259_200_000);
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  let release = () => {};
  let entered = () => {};
  const dispatched = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const { DeviceNarrationController } = await import("./device-panel");
    const { DeviceNarration } = await import("./device-flow");
    const { createByokSession } = await import("../byok/session");
    const requests: string[] = [];
    const byok = createByokSession(
      async (request) => {
        requests.push(JSON.parse(await new Request(request).text()).input);
        entered();
        await wait;
        return new Response(new Uint8Array(48000), {
          headers: { "Content-Type": "audio/pcm" },
        });
      },
      "https://app.test",
      { narrationFixture: true },
    );
    byok.replace("openrouter", "synthetic-controller-continuation-reference");
    const retained = {
      kind: "completed" as const,
      text: "Retained chapter",
      ...audioFromPCM(new Uint8Array(48000), () => {}),
    };
    let disk = JSON.stringify({
      version: 1,
      fingerprints: [],
      account: "alice",
      documentId: "doc",
      id: "controller-checkpoint",
      created: 1000,
      status: "paused",
      parts: [retained, { kind: "pending", text: "Remaining chapter" }],
    });
    const flow = new DeviceNarration("alice", "doc", {
      account: () => "alice",
      available: () => true,
      byok,
      store: {
        load: async () => disk,
        save: async (_scope, data, expected) => {
          if (disk !== expected) return false;
          disk = data;
          return true;
        },
        clear: async () => {},
      },
      sync: async () => "unused",
    });
    await act(async () =>
      root.render(
        <DeviceNarrationController
          flow={flow}
          available
          keyAvailable
          start={async () => {}}
        />,
      ),
    );
    const resume = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Resume generation",
    );
    expect(resume).toBeDefined();
    expect(host.textContent).toContain(
      "Each Resume starts a new 20-minute continuation",
    );
    const originalAudio = host.querySelector("audio")?.getAttribute("src");
    await act(async () => {
      resume?.click();
      await dispatched;
    });
    expect(requests).toEqual(["Remaining chapter"]);
    expect(host.textContent).toContain("Generating in the foreground");
    expect(host.textContent).toContain("1 of 2 parts retained");
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = flow.subscribe(() => {
        if (flow.state()?.status === "completed") {
          unsubscribe();
          resolve();
        }
      });
    });
    await act(async () => {
      release();
      await completed;
    });
    expect(host.textContent).toContain("2 of 2 parts retained");
    expect(host.querySelector("audio")?.getAttribute("src")).toBe(
      originalAudio,
    );
    expect(host.querySelectorAll("audio")).toHaveLength(2);
    expect(host.textContent).toContain("Sync completed recording");
    expect(host.textContent).not.toContain("Resume generation");
    expect(flow.state()?.created).toBe(1000);
  } finally {
    release();
    await act(async () => root.unmount());
    clock.mockRestore();
    dom.window.close();
    keys.forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    });
  }
});
