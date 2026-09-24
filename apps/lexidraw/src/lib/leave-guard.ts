/**
 * Asks before the app leaves a page with something to lose, however it
 * leaves: a click on an in-app link, a navigation the app starts itself, back
 * or forward, and closing or reloading the tab.
 *
 * Next navigates links and back/forward in listeners of its own, which a page
 * cannot veto from inside: a back is handled, and the page unmounted with its
 * listeners, before a listener the page added later gets its turn. So the
 * listeners here are installed once for the whole app, ahead of Next's: the
 * click listener on window in the capture phase, before React's on the
 * document, and the popstate listener before the app router adds its own.
 * The page with something to lose only registers what it would lose.
 */
export type LeaveGuard = {
  /** Leaving now needs the user, or a save, first. */
  mustAsk(): boolean;
  /** Settles leaving; answers whether to go. */
  ask(): Promise<boolean>;
};

let guard: LeaveGuard | null = null;

/** Registers the page's guard; answers its removal. */
export function setLeaveGuard(next: LeaveGuard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** Runs `navigate` once leaving is settled, for navigations the app starts. */
export function leaveThen(navigate: () => void): void {
  if (!guard?.mustAsk()) {
    navigate();
    return;
  }
  void guard.ask().then((go) => {
    if (go) navigate();
  });
}

/**
 * Installs the listeners on `win`; answers their removal. `push` is the
 * router's, for the link a click was held back from.
 */
export function installLeaveGuard(
  win: Window,
  push: (href: string) => void,
): () => void {
  /** A question is up; another way out meanwhile is held, not asked again. */
  let asking = false;
  /** Traversals this guard started, which pass or stop without asking. */
  let restoring = false;
  let leaving = false;
  /** Where the traversal a popstate reports started, where the browser says. */
  let traversedFrom: number | null = null;

  const onEntryChange = (event: Event) => {
    const { navigationType, from } = event as Event & {
      navigationType?: string;
      from?: { index: number };
    };
    traversedFrom =
      navigationType === "traverse" ? (from?.index ?? null) : null;
  };

  const onPopState = (event: PopStateEvent) => {
    if (leaving) {
      leaving = false;
      return;
    }
    if (restoring) {
      // Back where the router still is: it never heard of the traversal.
      restoring = false;
      event.stopImmediatePropagation();
      return;
    }
    if (!asking && !guard?.mustAsk()) return;
    event.stopImmediatePropagation();
    const delta = traversalDelta(win, traversedFrom);
    restoring = true;
    win.history.go(-delta);
    if (asking || !guard) return;
    asking = true;
    void guard.ask().then(
      (go) => {
        asking = false;
        if (!go) return;
        leaving = true;
        win.history.go(delta);
      },
      () => {
        asking = false;
      },
    );
  };

  const onClick = (event: MouseEvent) => {
    const href = inAppLink(event, win);
    if (href === null || !guard?.mustAsk()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    leaveThen(() => push(href));
  };

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!guard?.mustAsk()) return;
    event.preventDefault();
    // Browsers that predate preventDefault here ask on a returnValue.
    event.returnValue = "";
  };

  const navigation = navigationOf(win);
  navigation?.addEventListener("currententrychange", onEntryChange);
  win.addEventListener("popstate", onPopState, { capture: true });
  win.addEventListener("click", onClick, { capture: true });
  win.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    navigation?.removeEventListener("currententrychange", onEntryChange);
    win.removeEventListener("popstate", onPopState, { capture: true });
    win.removeEventListener("click", onClick, { capture: true });
    win.removeEventListener("beforeunload", onBeforeUnload);
  };
}

/** The Navigation API, where the browser has one. */
function navigationOf(win: Window): EventTarget | null {
  const navigation = (win as { navigation?: EventTarget }).navigation;
  return navigation ?? null;
}

/**
 * How many entries the traversal a popstate reports moved, negative for back.
 * Without the Navigation API to say, it was a back: forward needs an entry
 * past this page, which leaving it already asked about.
 */
function traversalDelta(win: Window, from: number | null): number {
  const current = (
    win as { navigation?: { currentEntry?: { index: number } | null } }
  ).navigation?.currentEntry;
  if (from === null || !current || current.index === from) return -1;
  return current.index - from;
}

/**
 * The in-app address a click follows, or null for a click that leaves this
 * page's tab alone or leaves the app: a new tab or window, a download,
 * another origin, a jump within the page, or a link in text being edited,
 * which the browser does not follow.
 */
function inAppLink(event: MouseEvent, win: Window): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  const target = event.target as Element | null;
  const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download"))
    return null;
  if (link.closest("[contenteditable='true'], [contenteditable='']"))
    return null;
  const url = new URL(link.href, win.location.href);
  const here = new URL(win.location.href);
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search + url.hash;
}
