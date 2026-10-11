import { afterAll, expect, mock, test } from "bun:test";
import { act } from "react";
import { installDom, render, click, button } from "~/test/dom";
installDom();
const originalFormData = globalThis.FormData;
globalThis.FormData = window.FormData;
afterAll(() => {
  globalThis.FormData = originalFormData;
});
import { DeviceAgentView } from "./device-view";
test("device form rejects blank, nonstring and oversized UTF8 prompt with visible validation and admits bounded DOM input", async () => {
  const starts: string[] = [];
  const view = await render(
    <DeviceAgentView
      checkpoint={null}
      available
      keyAvailable
      onStart={({ prompt }) => starts.push(prompt)}
      onResume={() => {}}
      onStop={() => {}}
    />,
  );
  const form = document.querySelector("form")!,
    input = document.querySelector("textarea")!;
  for (const prompt of ["   ", "😀".repeat(400)]) {
    input.value = prompt;
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(starts).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  }
  input.remove();
  const file = document.createElement("input");
  file.name = "prompt";
  file.type = "file";
  form.append(file);
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(starts).toHaveLength(0);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  file.remove();
  form.append(input);
  input.value = "Add a paragraph";
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(starts).toEqual(["Add a paragraph"]);
  await view.unmount();
});
const { createByokSession } = await import("../byok/session");
const byok = createByokSession(
  async () => {
    throw new Error("No provider");
  },
  "https://app.test",
  { agentFixture: true },
);
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "alice" } },
  }),
}));
mock.module("../byok/browser-session", () => ({
  useBrowserByok: () => byok,
  browserByokAccount: () => "alice",
  browserByokSessionGeneration: () => 1,
  browserByokStorageReady: async () => {},
}));
let stored: string | null = null,
  loads = 0,
  applies = 0;
mock.module("../narration/device-store", () => ({
  registerNarration: () => () => {},
  browserNarrationStore: {
    load: async () => {
      loads++;
      return stored;
    },
    save: async (_: string, data: string, expected: string | null) => {
      if (stored !== expected) return false;
      stored = data;
      return true;
    },
    clear: async () => {
      stored = null;
    },
  },
}));
let capability = {
  data: { available: true },
  isPending: false,
  error: null as Error | null,
  isError: false,
};
const retry = mock(async () => {}),
  utils = {
    entities: { load: { invalidate: async () => {} } },
    deviceAgent: { source: { fetch: async () => ({ revision: 1, text: "" }) } },
  };
const { installServerRuntime, createTestDatabase } = await import(
  "~/test/server-runtime"
);
await installServerRuntime();
const db = await createTestDatabase();
const schema = await import("@packages/drizzle/drizzle-schema");
const { PublicAccess } = await import("@packages/types");
const { DeviceAgentDocuments } = await import("~/server/entities/device-agent");
const { createDeviceAgentRouter } = await import(
  "~/server/api/routers/device-agent"
);
await db
  .insert(schema.users)
  .values({ id: "alice", name: "Alice", email: "panel@fixture.test" });
await db
  .insert(schema.entities)
  .values({
    id: "doc",
    userId: "alice",
    title: "Fixture",
    entityType: "document",
    publicAccess: PublicAccess.PRIVATE,
    updatedAt: new Date(1),
    elements: JSON.stringify({
      root: {
        type: "root",
        version: 1,
        children: [],
        direction: null,
        format: "",
        indent: 0,
      },
    }),
  });
const documents = new DeviceAgentDocuments(db.$client, () => 2);
const caller = createDeviceAgentRouter(() => documents).createCaller({
  drizzle: db,
  schema,
  session: { user: { id: "alice" }, expires: "2099-01-01" },
  auth: { kind: "session" },
  headers: new Headers(),
});
const apply = async (input: import("./device-core").DeviceMutation) => {
  applies++;
  return caller.commitEdit(input);
};
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => utils,
    deviceAgent: {
      capability: { useQuery: () => ({ ...capability, refetch: retry }) },
      commitEdit: { useMutation: () => ({ mutateAsync: apply }) },
    },
  },
}));
const { DeviceAgentPanel } = await import("./device-panel");
const { deviceAgentStart, deviceAgentFence, deviceAgentOutput } = await import(
  "./device-core"
);
test("capability pending and failure retain the owned controller and allow keyless retained edit reconciliation", async () => {
  const start = deviceAgentStart(
    "alice",
    "doc",
    "retained-action",
    Date.now(),
    "Add paragraph",
    { revision: 1, text: "" },
  );
  const plan = deviceAgentOutput(
    deviceAgentFence(start, Date.now()),
    '{"edits":["Add paragraph"]}',
  );
  const pending = deviceAgentOutput(
    deviceAgentFence(plan, Date.now()),
    '{"kind":"append","text":"Retained"}',
  );
  stored = JSON.stringify({ ...pending, status: "sync_failed" });
  const view = await render(<DeviceAgentPanel documentId="doc" />);
  expect(document.body.textContent).toContain("Retry retained edit");
  const initialLoads = loads;
  capability = { ...capability, isPending: true };
  await view.rerender(<DeviceAgentPanel documentId="doc" />);
  expect(button("Retry retained edit")).toBeDefined();
  expect(loads).toBe(initialLoads);
  capability = {
    ...capability,
    isPending: false,
    isError: true,
    error: new Error("failure"),
  };
  await view.rerender(<DeviceAgentPanel documentId="doc" />);
  expect(document.body.textContent).toContain("could not be loaded");
  expect(button("Retry retained edit")).toBeDefined();
  expect(loads).toBe(initialLoads);
  await click(button("Retry retained edit"));
  expect(applies).toBe(1);
  expect((await documents.read("alice", "doc")).text).toBe("Retained");
  expect(document.body.textContent).toContain("1 saved");
  expect(button("Resume on this device")?.disabled).toBe(true);
  await view.unmount();
});
