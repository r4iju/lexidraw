import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

const CONTENT = '[id^="lexical-content-"]';
const ACTIONS = 'button[aria-label="Document actions"]';
const TOC = 'aside[aria-label="Table of Contents"]';
const DESKTOP = { width: 1280, height: 900 };
const TABLET = { width: 768, height: 1024, hasTouch: true, isMobile: true };
const PHONE = { width: 375, height: 812, hasTouch: true, isMobile: true };
const ENTER = "cubic-bezier(0, 0, 0.2, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";
const STILL =
  /^(none|translate3d\(0px, 0px, 0px\) scale3d\(1, 1, 1\) rotate\(0deg\))$/;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One animation as it started: on what, in which state, for how long, how. */
type Motion = {
  who: string;
  state: string | undefined;
  ms: number;
  easing: string;
  /** Where it starts from and where it ends, as opacity and transform. */
  from: { opacity: string; transform: string };
  to: { opacity: string; transform: string };
};

/** A tab that records every animation as it starts, from its first paint. */
async function recordingTab(page: Page, reduced: boolean) {
  const tab = await page.browser().newPage();
  await tab.bringToFront();
  await tab.emulateMediaFeatures([
    {
      name: "prefers-reduced-motion",
      value: reduced ? "reduce" : "no-preference",
    },
  ]);
  await tab.evaluateOnNewDocument(() => {
    const motions: unknown[] = [];
    (window as unknown as { motions: unknown[] }).motions = motions;
    document.addEventListener(
      "animationstart",
      (event) => {
        const target = event.target as HTMLElement;
        const animation = target
          .getAnimations()
          .find(
            (candidate) =>
              (candidate as CSSAnimation).animationName === event.animationName,
          );
        const frames = (animation?.effect as KeyframeEffect | undefined)
          ?.getKeyframes()
          .map((frame) => ({
            opacity: String(frame.opacity ?? ""),
            transform: String(frame.transform ?? "none"),
          }));
        const style = getComputedStyle(target);
        const index = style.animationName
          .split(", ")
          .indexOf(event.animationName);
        motions.push({
          who:
            target.getAttribute("role") ??
            (target.hasAttribute("data-backdrop")
              ? "backdrop"
              : target.querySelector('[role="tooltip"]')
                ? "tooltip"
                : target.tagName.toLowerCase()),
          state: target.dataset.state,
          ms:
            Number.parseFloat(
              style.animationDuration.split(", ")[index] ?? "0",
            ) * 1000,
          easing:
            style.animationTimingFunction
              .match(/[^,(]+(?:\([^)]*\))?/g)
              ?.map((easing) => easing.trim())[index] ?? "",
          from: frames?.[0],
          to: frames?.at(-1),
        });
      },
      true,
    );
  });
  return {
    tab,
    /** What started animating while `act` ran, and in the pause after it. */
    async during(act: () => Promise<unknown>, settle = 400) {
      await tab.evaluate(() => {
        (window as unknown as { motions: unknown[] }).motions.length = 0;
      });
      await act();
      await pause(settle);
      return tab.evaluate(
        () => (window as unknown as { motions: Motion[] }).motions,
      );
    },
  };
}

function find(motions: Motion[], who: string, state?: string) {
  const found = motions.find(
    (motion) =>
      motion.who === who && (state === undefined || motion.state === state),
  );
  assert(
    found,
    `No ${who} ${state ?? ""} animation among ${JSON.stringify(motions.map(({ who, state }) => `${who}:${state}`))}`,
  );
  return found;
}

function timed(motion: Motion, ms: number, easing: string, what: string) {
  assert.equal(motion.ms, ms, `${what} lasts ${ms}ms`);
  assert.equal(motion.easing, easing, `${what} eases ${easing}`);
}

/** Translation along x and y where the animation starts, in px or %. */
function travel({ transform }: { transform: string }) {
  const match = transform.match(
    /translate3d\(([-\d.]+)(?:px|%), ([-\d.]+)(?:px|%)/,
  );
  return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
}

/**
 * Motion by the design's tokens: menus open in 150ms and close in 100ms,
 * dialogs in 200ms and 150ms with their backdrop in step, sheets and
 * sidebars in 250ms and 200ms from their edge, entering decelerated and
 * leaving accelerated; tooltips wait 500ms and fade without zooming, and
 * poll bars move by transform over 250ms. With reduced motion, fades stay
 * and nothing travels, zooms or pulses, and spinners slow down.
 */
export async function checkMotion(page: Page, fixtureId: string) {
  const path = `${appUrl}/documents/${fixtureId}`;
  for (const reduced of [false, true]) {
    const { tab, during } = await recordingTab(page, reduced);
    const open = async (viewport: typeof DESKTOP) => {
      await tab.setViewport(viewport);
      await tab.evaluate(() => localStorage.removeItem("lexidraw.sidebar"));
      await tab.goto(path, { waitUntil: "networkidle2" });
      await tab.addStyleTag({ content: "nextjs-portal { display: none; }" });
      await tab.waitForSelector(`${CONTENT} > p`);
      await pause(500);
    };
    const click = (selector: string) => tab.locator(selector).click();
    const still = (motion: Motion, what: string) => {
      assert.match(motion.from.transform, STILL, `${what} does not move`);
      assert.notEqual(motion.from.opacity, motion.to.opacity, `${what} fades`);
    };
    try {
      await tab.goto(path, { waitUntil: "domcontentloaded" });
      await open(DESKTOP);

      const menuIn = find(await during(() => click(ACTIONS)), "menu", "open");
      const menuOut = find(
        await during(() => tab.keyboard.press("Escape")),
        "menu",
        "closed",
      );
      if (reduced) still(menuIn, "A menu opening");
      else {
        timed(menuIn, 150, ENTER, "A menu opening");
        timed(menuOut, 100, EXIT, "A menu closing");
      }

      await click(ACTIONS);
      await pause(300);
      const dialogIn = await during(() =>
        tab.evaluate(() => {
          const rename = [
            ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
          ].find((item) => item.textContent?.trim().startsWith("Rename"));
          rename?.click();
        }),
      );
      const dialogOut = await during(() => tab.keyboard.press("Escape"));
      if (reduced) still(find(dialogIn, "dialog", "open"), "A dialog opening");
      else
        for (const [motions, state, ms, easing] of [
          [dialogIn, "open", 200, ENTER],
          [dialogOut, "closed", 150, EXIT],
        ] as const) {
          timed(
            find(motions, "dialog", state),
            ms,
            easing,
            `A dialog ${state}`,
          );
          timed(
            find(motions, "backdrop", state),
            ms,
            easing,
            `Its backdrop ${state}, in step`,
          );
        }

      if (!reduced) {
        const bold = `[role="toolbar"] button[aria-label^="Bold"]`;
        const tooltip = () =>
          tab.$eval(bold, (button) => button.getAttribute("data-state"));
        await tab.hover(bold);
        await pause(400);
        assert.equal(await tooltip(), "closed", "A tooltip waits 500ms");
        await pause(300);
        assert.equal(
          await tooltip(),
          "delayed-open",
          "A tooltip opens after 500ms",
        );
        const tip = find(
          await tab.evaluate(
            () => (window as unknown as { motions: Motion[] }).motions,
          ),
          "tooltip",
        );
        const scale = tip.from.transform.match(/scale3d\(([\d.]+)/)?.[1];
        assert(!scale || scale === "1", "A tooltip does not zoom");
        await tab.mouse.move(0, 0);
      }

      if (!reduced) {
        // Voting moves every bar; each grows or shrinks along its row.
        const vote = '[data-poll] button[role="checkbox"]';
        await tab.evaluate(() => {
          const runs: { property: string; ms: number }[] = [];
          (window as unknown as { runs: typeof runs }).runs = runs;
          document.addEventListener("transitionrun", (event) => {
            if (!(event.target as Element).closest("[data-poll] .relative"))
              return;
            const style = getComputedStyle(event.target as Element);
            const index = style.transitionProperty
              .split(", ")
              .indexOf(event.propertyName);
            runs.push({
              property: event.propertyName,
              ms:
                Number.parseFloat(
                  style.transitionDuration.split(", ")[index] ?? "0",
                ) * 1000,
            });
          });
        });
        await tab.locator(vote).click();
        await pause(400);
        const runs = await tab.evaluate(
          () =>
            (window as unknown as { runs: { property: string; ms: number }[] })
              .runs,
        );
        await tab.locator(vote).click();
        await tab.waitForFunction(() =>
          document
            .querySelector("[data-poll]")
            ?.textContent?.includes("3 votes total"),
        );
        assert.deepEqual(
          [...new Set(runs.map(({ property, ms }) => `${property} ${ms}ms`))],
          ["transform 250ms"],
          "A poll's bars move by transform over 250ms",
        );
      }

      // A drawer on a tablet slides in from the right edge, and back.
      await open(TABLET);
      const drawerIn = find(
        await during(() =>
          click('header button[aria-label="Table of contents"]'),
        ),
        "aside",
      );
      if (reduced) still(drawerIn, "A drawer opening");
      else {
        timed(drawerIn, 250, ENTER, "A drawer opening");
        assert(travel(drawerIn.from).x > 0, "A drawer comes from the right");
        await tab.waitForSelector(TOC);
        const drawerOut = find(
          await during(() => tab.keyboard.press("Escape")),
          "aside",
          "closed",
        );
        timed(drawerOut, 200, EXIT, "A drawer closing");
        assert(travel(drawerOut.to).x > 0, "A drawer leaves to the right");
      }

      // A menu on a phone is a sheet from the bottom edge.
      await open(PHONE);
      const sheetIn = find(await during(() => click(ACTIONS)), "menu", "open");
      const sheetOut = find(
        await during(() => tab.keyboard.press("Escape")),
        "menu",
        "closed",
      );
      if (reduced) still(sheetIn, "A sheet opening");
      else {
        timed(sheetIn, 250, ENTER, "A sheet opening");
        timed(sheetOut, 200, EXIT, "A sheet closing");
        assert(travel(sheetIn.from).y > 0, "A sheet rises from the bottom");
        assert(travel(sheetOut.to).y > 0, "A sheet drops to the bottom");
      }

      const idle = await tab.evaluate(() => {
        const probe = (className: string) => {
          const element = document.createElement("div");
          element.className = className;
          document.body.append(element);
          const running = element.getAnimations().map((animation) => ({
            name: (animation as CSSAnimation).animationName,
            ms: Number(animation.effect?.getComputedTiming().duration),
            infinite:
              animation.effect?.getComputedTiming().iterations === Infinity,
          }));
          element.remove();
          return running;
        };
        return {
          skeleton: probe("animate-skeleton"),
          spin: probe("animate-spin"),
        };
      });
      if (reduced) {
        assert(
          !idle.skeleton.some(({ infinite }) => infinite),
          `Nothing pulses (${JSON.stringify(idle)})`,
        );
        assert(
          (idle.spin[0]?.ms ?? 0) >= 1500,
          `A spinner turns slowly (${JSON.stringify(idle.spin)})`,
        );
      } else
        assert(
          idle.skeleton.some(({ infinite }) => infinite),
          "A skeleton pulses",
        );
    } finally {
      await tab.close();
    }
  }
  await page.bringToFront();
  console.log(
    "Motion: menus, dialogs, sheets and drawers on the design's timings; reduced motion fades without moving",
  );
}
