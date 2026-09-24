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
    </body>`,
    { url: "https://app.test/dashboard" },
  );
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
  const state = { asked: 0, answer: (_go: boolean) => {} };
  cleanups.push(
    setLeaveGuard({
      mustAsk: () => true,
      ask: () => {
        state.asked++;
        return new Promise((resolve) => {
          state.answer = resolve;
        });
      },
    }),
  );
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
    expect(question.asked).toBe(0);
    expect(clicked).toEqual(["tab", "out", "in", "text"]);
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
});
