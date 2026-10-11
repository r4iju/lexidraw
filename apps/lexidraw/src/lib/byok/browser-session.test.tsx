import { expect, mock, test } from "bun:test";
import { StrictMode, Suspense } from "react";
import { installDom, render } from "~/test/dom";
import {
  browserByok,
  browserByokAccount,
  browserByokSessionGeneration,
} from "./browser-session";
installDom();
window.fetch = globalThis.fetch;
let identity = {
  data: { user: { id: "account-a" }, expires: "2099-01-01T00:00:00Z" },
  status: "authenticated",
};
mock.module("next-auth/react", () => ({ useSession: () => identity }));
const { ByokSessionLifecycle } = await import(
  "~/components/byok-session-lifecycle"
);
function AbandonedReader(): never {
  browserByok("account-b");
  throw new Promise(() => {});
}
test("an abandoned account render cannot retire the committed account credential", async () => {
  const view = await render(
    <StrictMode>
      <ByokSessionLifecycle />
    </StrictMode>,
  );
  const session = browserByok("account-a");
  const reference = session.replace(
    "openrouter",
    "synthetic-lifecycle-reference-291",
  );
  const generation = browserByokSessionGeneration();
  try {
    await view.rerender(
      <StrictMode>
        <ByokSessionLifecycle />
        <Suspense fallback={<p>Waiting</p>}>
          <AbandonedReader />
        </Suspense>
      </StrictMode>,
    );
    expect(browserByokAccount()).toBe("account-a");
    expect(session.reference()).toBe(reference);
    expect(browserByokSessionGeneration()).toBe(generation);
  } finally {
    await view.unmount();
  }
});

test("an old expiry callback cannot clear a newer committed same-account session", async () => {
  const original = window.setTimeout;
  const callbacks: (() => void)[] = [];
  window.setTimeout = ((handler: TimerHandler) => {
    if (typeof handler === "function") callbacks.push(() => handler());
    return callbacks.length;
  }) as typeof window.setTimeout;
  const view = await render(<ByokSessionLifecycle />);
  try {
    const oldExpiry = callbacks[0];
    identity = {
      ...identity,
      data: { ...identity.data, expires: "2099-02-01T00:00:00Z" },
    };
    await view.rerender(<ByokSessionLifecycle />);
    const session = browserByok();
    const reference = session.replace(
      "openrouter",
      "synthetic-renewed-session-key-291",
    );
    oldExpiry?.();
    expect(session.reference()).toBe(reference);
    expect(browserByokAccount()).toBe("account-a");
  } finally {
    window.setTimeout = original;
    await view.unmount();
  }
});
