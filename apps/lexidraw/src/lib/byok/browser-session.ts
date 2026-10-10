import { clearNarrationAccount } from "../narration/device-store";
import { installBrowserBoundary } from "./browser-boundary";
import { createByokSession } from "./session";

let session: ReturnType<typeof createByokSession> | undefined;
let account: string | undefined;
export function browserByok(accountId?: string) {
  if (!session) {
    const network = window.fetch.bind(window);
    session = createByokSession(network, window.location.origin);
    installBrowserBoundary(window, session);
  }
  if (accountId !== undefined && account !== accountId) {
    session.remove();
    if (account) void clearNarrationAccount(account).catch(() => {});
    account = accountId;
  }
  return session;
}
export function clearBrowserByok() {
  session?.remove();
  if (account) void clearNarrationAccount(account).catch(() => {});
  account = undefined;
}

export function browserByokAccount() {
  return account;
}
