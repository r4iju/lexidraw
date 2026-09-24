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

/** The page's guard, and whether a question of its is up. */
type Registered = {
  guard: LeaveGuard;
  asking: boolean;
  /** Answers "stay" once the page is gone, to a question it left open. */
  gone: Promise<false>;
};

let registered: Registered | null = null;

/** Registers the page's guard; answers its removal. */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  let leave = () => {};
  const entry: Registered = {
    guard,
    asking: false,
    gone: new Promise((resolve) => {
      leave = () => resolve(false);
    }),
  };
  registered = entry;
  return () => {
    if (registered === entry) registered = null;
    leave();
  };
}

/** Asks `entry`'s guard; a page that goes away first answers "stay". */
function askOf(entry: Registered): Promise<boolean> {
  return Promise.race([entry.guard.ask(), entry.gone]);
}

/** Runs `navigate` once leaving is settled, for navigations the app starts. */
export function leaveThen(navigate: () => void): void {
  const entry = registered;
  if (!entry?.guard.mustAsk()) {
    navigate();
    return;
  }
  void askOf(entry).then(
    (go) => {
      if (go) navigate();
    },
    () => {},
  );
}

/**
 * Installs the listeners on `win`; answers their removal. `push` is the
 * router's, for the link a click was held back from.
 */
export function installLeaveGuard(
  win: Window,
  push: (href: string) => void,
): () => void {
  /** Traversals this guard started, which pass or stop without asking. */
  let restoring = false;
  let leaving = false;
  /** Where the traversal a popstate reports started, where the browser says. */
  let traversedFrom: { index?: number; url?: string } | null = null;

  const onEntryChange = (event: Event) => {
    const { navigationType, from } = event as Event & {
      navigationType?: string;
      from?: { index?: number; url?: string };
    };
    traversedFrom = navigationType === "traverse" ? (from ?? null) : null;
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
    const entry = registered;
    if (!entry || withinPage(traversedFrom?.url, win)) return;
    if (!entry.asking && !entry.guard.mustAsk()) return;
    event.stopImmediatePropagation();
    const delta = traversalDelta(win, traversedFrom?.index);
    restoring = true;
    win.history.go(-delta);
    // Another way out while the question is up is held, not asked again.
    if (entry.asking) return;
    entry.asking = true;
    const done = () => {
      entry.asking = false;
    };
    void askOf(entry).then((go) => {
      done();
      if (!go || registered !== entry) return;
      leaving = true;
      win.history.go(delta);
    }, done);
  };

  const onClick = (event: MouseEvent) => {
    const href = inAppLink(event, win);
    if (href === null || !registered?.guard.mustAsk()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    leaveThen(() => push(href));
  };

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!registered?.guard.mustAsk()) return;
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
function traversalDelta(win: Window, from: number | undefined): number {
  const current = (
    win as { navigation?: { currentEntry?: { index: number } | null } }
  ).navigation?.currentEntry;
  if (from === undefined || !current || current.index === from) return -1;
  return current.index - from;
}

/**
 * A traversal from `from` stays on this page, as back from a jump to a
 * heading does. Without the Navigation API to say where it came from, it is
 * taken to leave.
 */
function withinPage(from: string | undefined, win: Window): boolean {
  if (from === undefined) return false;
  const before = new URL(from);
  const now = new URL(win.location.href);
  return before.pathname === now.pathname && before.search === now.search;
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
  // Menus close before they navigate, and ask through `leaveThen` then.
  if (link.closest("[data-asks-before-leaving]")) return null;
  const url = new URL(link.href, win.location.href);
  const here = new URL(win.location.href);
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search + url.hash;
}
