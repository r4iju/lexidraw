import { expect, mock, test } from "bun:test";
import { act } from "react";
import { SessionProvider } from "next-auth/react";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";
import { createClient } from "@libsql/client";
import { api } from "~/trpc/react";
import { installDom, render, click, button } from "~/test/dom";
import {
  commitBrowserByok,
  clearBrowserByok,
} from "~/lib/byok/browser-session";
import { installServerRuntime } from "~/test/server-runtime";
import { supplierFixture } from "~/test/supplier-fixture";
import { ProLedger } from "~/server/pro/ledger";
import { ProTextOperation } from "~/server/pro/operation";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const schema = await import("@packages/drizzle/drizzle-schema");
const { createProRouter } = await import("~/server/api/routers/pro");
const { default: AutocompletePlugin } = await import("./index");
installDom("http://localhost");
window.fetch = Object.assign(
  async () => {
    throw new Error("Unexpected device HTTP");
  },
  { preconnect() {} },
);
async function until(condition: () => boolean) {
  for (let i = 0; i < 300 && !condition(); i++)
    await act(async () => {
      await Bun.sleep(10);
    });
  expect(condition()).toBe(true);
}
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("replaced real suggestion registration hides old notices and ignores late cancellation while original paid identity remains recoverable", async () => {
  const account = "synthetic-d3-suggestion";
  await db.insert(schema.users).values({
    id: account,
    name: "Synthetic tester",
    email: "d3-suggestion@example.test",
    config: { aiPower: { mode: "pro" }, autocomplete: { enabled: true } },
  });
  const storage = createClient({ url: ":memory:" });
  for (const name of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
  ])
    await storage.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(storage, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => 1000,
  });
  await ledger.grantEligibility("owner", account, "synthetic tester");
  await ledger.grantPeriod("owner", {
    accountId: account,
    eventId: "d3-trial",
    startsAt: 1000,
    endsAt: 100000,
    subcredits: 10_000_000,
    reason: "synthetic trial",
    environment: "test",
  });
  let supplierCalls = 0;
  const executor = new ProTextOperation(ledger, async () => {
    supplierCalls++;
    return { kind: "unknown" };
  });
  const caller = createProRouter({
    ledger: () => ledger,
    dispatch: (id, text, owner) => executor.execute(owner, id, text),
  }).createCaller({
    drizzle: db,
    schema,
    session: { user: { id: account }, expires: "2099-01-01" },
    auth: { kind: "session" },
    headers: new Headers(),
  });
  const calls: { path: string; input: unknown }[] = [];
  let originalId = "";
  let holdRead = false;
  let readEntered = false;
  let cancelEntered = false;
  const readGate = gate();
  const cancelGate = gate();
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const client = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            calls.push({ path: op.path, input: op.input });
            const respond = async () => {
              // The intercepted transport carries unknown inputs; each real public router procedure validates its schema.
              switch (op.path) {
                case "auth.getPowerPreference":
                  return { mode: "pro" };
                case "config.getAutocompleteConfig":
                  return { enabled: true };
                case "pro.status":
                  return caller.status();
                case "pro.autocomplete": {
                  const result = await caller.autocomplete(
                    op.input as Parameters<typeof caller.autocomplete>[0],
                  );
                  originalId = result.id;
                  return result;
                }
                case "pro.operation": {
                  const result = await caller.operation(
                    op.input as Parameters<typeof caller.operation>[0],
                  );
                  if (holdRead) {
                    readEntered = true;
                    await readGate.promise;
                  }
                  return result;
                }
                case "pro.autocompleteRecovery":
                  return caller.autocompleteRecovery(
                    op.input as Parameters<
                      typeof caller.autocompleteRecovery
                    >[0],
                  );
                case "pro.cancel":
                  cancelEntered = true;
                  await cancelGate.promise;
                  throw new Error("Synthetic lost cancellation response");
                default:
                  throw new Error(`Unexpected in-process request ${op.path}`);
              }
            };
            void respond().then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error) => observer.error(new TRPCClientError(String(error))),
            );
          }),
    ],
  });
  const owner = commitBrowserByok(account);
  let editor: LexicalEditor | undefined;
  function EditorRoot() {
    [editor] = useLexicalComposerContext();
    return (
      <div contentEditable ref={(element) => editor?.setRootElement(element)} />
    );
  }
  const node = (title: string) => (
    <SessionProvider session={{ user: { id: account }, expires: "2099-01-01" }}>
      <PathParamsContext.Provider
        value={{ documentId: "synthetic-d3-document" }}
      >
        <QueryClientProvider client={query}>
          <api.Provider client={client} queryClient={query}>
            <LexicalComposer
              initialConfig={{
                namespace: "D3Suggestion",
                onError: (error) => {
                  throw error;
                },
              }}
            >
              <EditorRoot />
              <AutocompletePlugin title={title} />
            </LexicalComposer>
          </api.Provider>
        </QueryClientProvider>
      </PathParamsContext.Provider>
    </SessionProvider>
  );
  const view = await render(node("Original title"));
  const type = async (text: string) =>
    act(async () => {
      editor?.update(
        () => {
          $getRoot().clear();
          const value = $createTextNode(text);
          $getRoot().append($createParagraphNode().append(value));
          value.selectEnd();
        },
        { discrete: true },
      );
    });
  const mainStatus = () =>
    document.querySelector('span[role="status"]')?.textContent ?? "";
  try {
    await until(() => mainStatus().includes("On"));
    await type("Hello original");
    await until(() => mainStatus().includes("reconciling"));
    expect(originalId).not.toBe("");
    await view.rerender(node("Replacement title"));
    expect(mainStatus()).toBe("On · accept with Tab");
    expect(button("Refresh owned suggestion")).toBeDefined();
    // Respect the real registration's shared six-second request rate.
    await act(async () => {
      await Bun.sleep(6100);
    });
    holdRead = true;
    await type("Hello changed");
    await until(() => readEntered);
    await view.rerender(node("Newest title"));
    await act(async () => readGate.release());
    await until(() => cancelEntered);
    await act(async () => cancelGate.release());
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(mainStatus()).toBe("On · accept with Tab");
    expect(document.body.textContent).not.toContain(
      "Cancellation is unconfirmed. Refresh owned suggestion status.",
    );
    holdRead = false;
    await click(button("Refresh owned suggestion"));
    await until(
      () => calls.filter((x) => x.path === "pro.operation").length >= 2,
    );
    expect(
      calls.filter((x) => x.path === "pro.operation").map((x) => x.input),
    ).toEqual([{ id: originalId }, { id: originalId }]);
    expect(calls.filter((x) => x.path === "pro.autocomplete")).toHaveLength(1);
    expect(supplierCalls).toBe(1);
    expect((await caller.operation({ id: originalId })).state).toBe("unknown");
    await act(async () =>
      query.setQueryData(
        getQueryKey(api.auth.getPowerPreference, undefined, "query"),
        { mode: "byok", provider: "openrouter" },
      ),
    );
    await act(async () =>
      owner.session.replace(
        "openrouter",
        "sk-or-v1-SyntheticD3ScopedReferenceXYZ",
      ),
    );
    await act(async () => {
      await Bun.sleep(20);
    });
    expect(mainStatus()).toBe("On · accept with Tab");
    expect(button("Refresh owned suggestion")).toBeDefined();
  } finally {
    readGate.release();
    cancelGate.release();
    await view.unmount();
    query.clear();
    storage.close();
    clearBrowserByok(owner.generation, owner.expirationLease);
  }
}, 20000);
