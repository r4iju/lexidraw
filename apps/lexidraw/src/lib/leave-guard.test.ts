/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { installLeaveGuard, leaveThen, setLeaveGuard } from "./leave-guard";

/** History traversal in jsdom answers on a later task. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * An app on `/documents/1`, reached from `/dashboard` in-app, with the guard
 * installed before the router's own listeners, as the root layout does.
 */
function app() {
  const { window } = new JSDOM(
    `<!doctype html><body>
      <a id="in" href="/dashboard">in</a>
      <a id="tab" href="/dashboard" target="_blank">tab</a>
      <a id="out" href="https://elsewhere.test/">out</a>
      <div contenteditable="true"><a id="text" href="/dashboard">text</a></div>
      <div data-asks-before-leaving><a id="menu" href="/dashboard">menu</a></div>
    </body>`,
    { url: "https://app.test/dashboard" },
  );
  // The Navigation API, as far as the guard reads it: where a traversal came
  // from, reported before its popstate.
  const navigation = new window.EventTarget();
  Object.assign(window, { navigation });
  let shown = window.location.href;
  window.addEventListener(
    "popstate",
    () => {
      navigation.dispatchEvent(
        Object.assign(new window.Event("currententrychange"), {
          navigationType: "traverse",
          from: { url: shown },
        }),
      );
    },
    { capture: true },
  );
  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args) => {
    pushState(...args);
    shown = window.location.href;
  };
  const pushed: string[] = [];
  cleanups.push(
    installLeaveGuard(window as unknown as Window, (href) => pushed.push(href)),
  );
  // What Next hears: back and forward on window, link clicks through React's
  // listener on the document.
  const routed: string[] = [];
  window.addEventListener("popstate", () =>
    routed.push(window.location.pathname),
  );
  const clicked: string[] = [];
  window.document.addEventListener("click", (event) =>
    clicked.push((event.target as Element).id),
  );
  window.history.pushState({}, "", "/documents/1");
  window.addEventListener("popstate", () => {
    shown = window.location.href;
  });

  const click = (id: string, init: MouseEventInit = {}) => {
    const event = new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    window.document.getElementById(id)?.dispatchEvent(event);
    return event;
  };
  return { window, pushed, routed, clicked, click };
}

/** A guard with something to lose, whose question the test answers. */
function asking() {
  const state = { asked: 0, answer: (_go: boolean) => {}, remove: () => {} };
  state.remove = setLeaveGuard({
    mustAsk: () => true,
    ask: () => {
      state.asked++;
      return new Promise((resolve) => {
        state.answer = resolve;
      });
    },
  });
  cleanups.push(state.remove);
  return state;
}

describe("leaving a page that has something to lose", () => {
  test("a back waits for the user: staying keeps the page, going goes back once", async () => {
    const { window, routed } = app();
    const question = asking();

    window.history.back();
    await settled();
    expect(question.asked).toBe(1);
    expect(routed).toEqual([]);
    expect(window.location.pathname).toBe("/documents/1");

    question.answer(false);
    await settled();
    expect(routed).toEqual([]);
    expect(window.location.pathname).toBe("/documents/1");

    window.history.back();
    await settled();
    expect(question.asked).toBe(2);
    question.answer(true);
    await settled();
    expect(routed).toEqual(["/dashboard"]);
    expect(window.location.pathname).toBe("/dashboard");
  });

  test("an in-app link waits for the user, then goes where it pointed", async () => {
    const { pushed, clicked, click } = app();
    const question = asking();

    expect(click("in").defaultPrevented).toBe(true);
    expect(clicked).toEqual([]);
    question.answer(true);
    await settled();
    expect(pushed).toEqual(["/dashboard"]);
  });

  test("links that leave nothing behind are not asked about", () => {
    const { pushed, clicked, click } = app();
    const question = asking();

    click("tab");
    click("out");
    click("in", { metaKey: true });
    click("text");
    // A menu closes itself first, then asks through leaveThen.
    click("menu");
    expect(question.asked).toBe(0);
    expect(clicked).toEqual(["tab", "out", "in", "text", "menu"]);
    expect(pushed).toEqual([]);
  });

  test("a navigation the app starts itself waits for the user", async () => {
    const question = asking();
    let went = 0;
    leaveThen(() => went++);
    expect(went).toBe(0);
    question.answer(true);
    await settled();
    expect(went).toBe(1);
  });

  test("closing the tab asks the browser to confirm", () => {
    const { window } = app();
    asking();
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test("with nothing to lose, links and back go as they always did", async () => {
    const { window, routed, clicked, click } = app();

    click("in");
    window.history.back();
    await settled();
    expect(clicked).toEqual(["in"]);
    expect(routed).toEqual(["/dashboard"]);
  });

  test("back from a jump within the page is not asked about", async () => {
    const { window, routed } = app();
    const question = asking();

    window.history.pushState({}, "", "/documents/1#part-two");
    window.history.back();
    await settled();
    expect(question.asked).toBe(0);
    expect(routed).toEqual(["/documents/1"]);
  });

  test("a question its page went away without answering holds nothing back", async () => {
    const { window, routed } = app();
    const left = asking();
    window.history.back();
    await settled();
    expect(left.asked).toBe(1);

    // The page went away another way, as by a link, with the question open.
    left.remove();
    const next = asking();
    window.history.back();
    await settled();
    expect(next.asked).toBe(1);

    left.answer(true);
    await settled();
    expect(routed).toEqual([]);
    expect(window.location.pathname).toBe("/documents/1");
  });
});
