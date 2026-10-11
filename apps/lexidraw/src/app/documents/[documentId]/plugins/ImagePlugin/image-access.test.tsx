import { expect, test } from "bun:test";
import { act } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { api } from "~/trpc/react";
import { installDom, render, button, click } from "~/test/dom";
import { Dialog } from "~/components/ui/dialog";
import {
  commitBrowserByok,
  clearBrowserByok,
} from "~/lib/byok/browser-session";
installDom("http://localhost");
window.fetch = Object.assign(
  async () => {
    throw new Error("No device HTTP expected");
  },
  { preconnect() {} },
);
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  value: () => ({ filter: "none", measureText: () => ({ width: 0 }) }),
});
const { ImageProvider, LexicalImageProvider } = await import(
  "~/hooks/use-image-insertion"
);
const { ImageGenerationProvider, LexicalImageGenerationProvider } =
  await import("~/hooks/use-image-generation");
const { InsertImageDialog } = await import("./index");
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++)
    await act(async () => {
      await Bun.sleep(5);
    });
  expect(condition()).toBe(true);
}
test("production image dialog uses provider loading and retry state for its reason and generation gate", async () => {
  const owner = commitBrowserByok("synthetic-d3-image");
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const calls: string[] = [];
  let release: ((value: unknown) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  let reason = "";
  const client = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            calls.push(op.path);
            if (op.path === "auth.getPowerPreference") {
              observer.next({ result: { data: { mode: "pro" } } });
              observer.complete();
            } else if (op.path === "imagePower.capability") {
              if (reason) {
                observer.next({
                  result: { data: { available: false, reason } },
                });
                observer.complete();
              } else {
                release = (data) => {
                  observer.next({ result: { data } });
                  observer.complete();
                };
                fail = (error) =>
                  observer.error(new TRPCClientError(error.message));
              }
            } else throw new Error(`Unexpected in-process request ${op.path}`);
          }),
    ],
  });
  function Surface() {
    const [editor] = useLexicalComposerContext();
    return (
      <Dialog>
        <InsertImageDialog
          activeEditor={editor}
          onClose={() => {}}
          onInsert={() => {
            throw new Error("No insert expected");
          }}
        />
      </Dialog>
    );
  }
  const node = (signedIn: boolean) => (
    <SessionProvider
      session={
        signedIn
          ? { user: { id: "synthetic-d3-image" }, expires: "2099-01-01" }
          : null
      }
    >
      <QueryClientProvider client={query}>
        <api.Provider client={client} queryClient={query}>
          <LexicalComposer
            initialConfig={{
              namespace: "D3Image",
              onError: (error) => {
                throw error;
              },
            }}
          >
            <ImageProvider>
              <LexicalImageProvider>
                <ImageGenerationProvider
                  entityId="synthetic-d3-document"
                  signedIn={signedIn}
                >
                  <LexicalImageGenerationProvider
                    persist={async () => {
                      throw new Error("No persistence expected");
                    }}
                  >
                    <Surface />
                  </LexicalImageGenerationProvider>
                </ImageGenerationProvider>
              </LexicalImageProvider>
            </ImageProvider>
          </LexicalComposer>
        </api.Provider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = await render(node(true));
  const action = () => button("Generate (AI)");
  try {
    await until(() => release !== undefined);
    expect(action()?.disabled).toBe(true);
    expect(action()?.title).toBe("Loading Image capability…");
    await act(async () => fail?.(new Error("Synthetic capability failure")));
    await until(() => action()?.title.includes("could not be loaded") === true);
    expect(action()?.disabled).toBe(true);
    expect(button("Retry")).toBeDefined();
    reason = "Synthetic executor unavailable, service not verified.";
    await click(button("Retry"));
    await until(() => action()?.title === reason);
    expect(action()?.disabled).toBe(true);
    const capabilityCount = calls.filter(
      (x) => x === "imagePower.capability",
    ).length;
    await view.rerender(node(false));
    await act(async () => {
      await Bun.sleep(20);
    });
    expect(action()?.title).toBe("Sign in to generate images.");
    expect(calls.filter((x) => x === "imagePower.capability").length).toBe(
      capabilityCount,
    );
    expect(calls.some((x) => x === "imagePower.generate")).toBe(false);
  } finally {
    await view.unmount();
    query.clear();
    clearBrowserByok(owner.generation, owner.expirationLease);
  }
});
