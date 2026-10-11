import { useSyncExternalStore } from "react";
import { clearNarrationAccount } from "../narration/device-store";
import { installBrowserBoundary } from "./browser-boundary";
import { createByokSession } from "./session";

let session: ReturnType<typeof createByokSession> | undefined;
let account: string | undefined;
let generation = 0;
let expirationLease = 0;
const cleanup = new Map<string, Promise<void>>();
function clearAccount(id: string) {
  const previous = cleanup.get(id) ?? Promise.resolve();
  const pending = previous.then(() => clearNarrationAccount(id));
  cleanup.set(id, pending);
  void pending.catch(() => {});
}
export function browserByokSessionGeneration() {
  return generation;
}
export async function browserByokStorageReady(id: string) {
  for (;;) {
    const pending = cleanup.get(id);
    if (!pending) return;
    await pending;
    if (cleanup.get(id) === pending) {
      cleanup.delete(id);
      return;
    }
  }
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => {
  for (const listener of listeners) listener();
};
export function commitBrowserByok(accountId: string) {
  if (!session) {
    const network = window.fetch.bind(window);
    session = createByokSession(network, window.location.origin);
    installBrowserBoundary(window, session);
  }
  if (accountId !== undefined && account !== accountId) {
    session.remove();
    generation++;
    if (account) clearAccount(account);
    account = accountId;
  }
  expirationLease++;
  notify();
  return { session, generation, expirationLease };
}

// Read-only acquisition, including during abandoned renders.
export function browserByok(_accountId?: string) {
  if (!session) throw new Error("Device credential owner is not committed");
  return session;
}
export function useBrowserByok(accountId: string | undefined) {
  useSyncExternalStore(
    subscribe,
    () => generation,
    () => 0,
  );
  return accountId && account === accountId ? session : undefined;
}
export function clearBrowserByok(
  expectedGeneration?: number,
  expectedLease?: number,
) {
  if (expectedGeneration !== undefined && generation !== expectedGeneration)
    return;
  if (expectedLease !== undefined && expirationLease !== expectedLease) return;
  session?.remove();
  generation++;
  if (account) clearAccount(account);
  account = undefined;
  notify();
}

export function browserByokAccount() {
  return account;
}
