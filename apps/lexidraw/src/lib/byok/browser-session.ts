import { clearNarrationAccount } from "../narration/device-store";
import { installBrowserBoundary } from "./browser-boundary";
import { createByokSession } from "./session";

let session: ReturnType<typeof createByokSession> | undefined;
let account: string | undefined;
let generation = 0;
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
export function browserByok(accountId?: string) {
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
  return session;
}
export function clearBrowserByok() {
  session?.remove();
  generation++;
  if (account) clearAccount(account);
  account = undefined;
}

export function browserByokAccount() {
  return account;
}
