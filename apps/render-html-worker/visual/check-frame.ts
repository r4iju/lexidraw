import assert from "node:assert/strict";
import { PNG } from "pngjs";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "@packages/dev-stack";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const APP_BAR = '[data-component-name="AppBar"]';

/** The app bar as a reader meets it: its box, its crumbs and its controls. */
async function appBar(page: Page) {
  await page.waitForSelector(APP_BAR, { visible: true, timeout: 20_000 });
  return page.$eval(APP_BAR, (bar) => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        visible:
          rect.width > 0 &&
          style.visibility !== "hidden" &&
          rect.right <= innerWidth &&
          rect.left >= 0,
      };
    };
    const crumbs = [
      ...bar.querySelectorAll('nav[aria-label="Breadcrumb"] li'),
    ].map((li) => li.textContent?.trim() ?? "");
    return {
      bar: box(bar),
      home: box(bar.querySelector('nav[aria-label="Breadcrumb"] a')),
      crumbs,
      account: box(bar.querySelector('button[aria-label="Account"]')),
      theme: box(bar.querySelector('button[aria-label="Theme"]')),
      back: box(bar.querySelector('a[aria-label^="Back to"]')),
      status: bar.querySelector("[data-save-status]")?.textContent ?? null,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}

/** Opens a menu from its trigger and answers its items, in order. */
async function menuItems(page: Page, trigger: string) {
  await page.locator(trigger).click();
  await page.waitForSelector('[role="menu"]', { visible: true });
  await pause(150);
  return page.$$eval(
    '[role="menu"] :is([role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="separator"])',
    (items) =>
      items
        .filter((item) => item.getClientRects().length > 0)
        .map((item) =>
          item.getAttribute("role") === "separator"
            ? "|"
            : (item.textContent?.trim() ?? ""),
        ),
  );
}

/** Menu items, one group per run between separators. */
function groups(items: string[]) {
  return items
    .join("\n")
    .split("|")
    .map((group) => group.split("\n").filter(Boolean));
}

async function choose(page: Page, text: string) {
  await page.evaluate((text) => {
    const item = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menu"] :is([role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"])',
      ),
    ].find((element) => element.textContent?.trim().startsWith(text));
    if (!item) throw new Error(`Missing menu item ${text}`);
    item.click();
  }, text);
  await pause(200);
}

async function clickButton(page: Page, name: string, within = "body") {
  await page.evaluate(
    (name, within) => {
      const button = [
        ...document.querySelectorAll<HTMLElement>(`${within} button`),
      ].find(
        (element) =>
          element.textContent?.trim() === name ||
          element.getAttribute("aria-label") === name,
      );
      if (!button) throw new Error(`Missing ${name} button`);
      button.click();
    },
    name,
    within,
  );
  await pause(200);
}

async function dialogText(page: Page) {
  return page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], .Dialog',
        ),
      ]
        .map((dialog) => dialog.textContent ?? "")
        .join(" ") || null,
  );
}

async function pressSave(page: Page) {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.keyboard.press("s");
  await page.keyboard.up(modifier);
}

/** Every text the save status showed from now on, in order. */
async function recordStatus(page: Page) {
  await page.evaluate((selector) => {
    const status = document.querySelector(`${selector} [data-save-status]`);
    if (!status) throw new Error("Missing save status");
    const said: string[] = [status.textContent ?? ""];
    (window as unknown as { said: string[] }).said = said;
    new MutationObserver(() => {
      const text = status.textContent ?? "";
      if (said.at(-1) !== text) said.push(text);
    }).observe(status, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, APP_BAR);
}

/** How much of the screen is the fixture drawing's red. */
async function redPixels(page: Page) {
  const shot = PNG.sync.read(
    Buffer.from(await page.screenshot({ type: "png" })),
  );
  let red = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    const [r = 0, g = 0, b = 0] = shot.data.subarray(i, i + 3);
    // Red on a light canvas, and the pink a dark canvas turns it into.
    if (r > 180 && r - g > 80 && Math.abs(g - b) < 40) red++;
  }
  return red;
}

/** Sets the account's auto-save from the ⋯ menu; answers what it was. */
export async function setAutoSave(page: Page, on: boolean) {
  await menuItems(page, `${APP_BAR} button[aria-label="Document actions"]`);
  const was = await page.$$eval(
    '[role="menu"] [role="menuitemcheckbox"]',
    (items) =>
      items.some(
        (item) =>
          item.textContent?.trim() === "Auto-save" &&
          item.getAttribute("aria-checked") === "true",
      ),
  );
  if (was === on) await page.keyboard.press("Escape");
  else await choose(page, "Auto-save");
  await pause(300);
  return was;
}

const said = (page: Page) =>
  page.evaluate(() => (window as unknown as { said: string[] }).said);

/**
 * The frame every signed-in page sits in, and the drawing page inside it:
 * one app bar in one place, titles in the tab, saving said and done with the
 * keyboard, the theme within reach, and a drawing that opens dark, fitted and
 * themed like the app, whose destructive actions ask first.
 */
export async function checkFrame(
  page: Page,
  {
    fixtureId,
    emptyId,
    drawingId,
  }: { fixtureId: string; emptyId: string; drawingId: string },
) {
  // Streamed content is revealed on an animation frame, which a background tab never gets.
  await page.bringToFront();
  await signInToDev(page, appUrl);
  const theme = await page.evaluate(() => localStorage.getItem("theme"));
  try {
    await checkBar(page, emptyId, drawingId);
    await checkSettings(page);
    await checkDocument(page, emptyId);
    await checkEmbedded(page, fixtureId);
    await checkDrawing(page, drawingId);
  } finally {
    await page.evaluate((theme) => {
      if (theme) localStorage.setItem("theme", theme);
      else localStorage.removeItem("theme");
    }, theme);
  }
  console.log(
    "Frame: app bar, tab titles, save status and Cmd+S, menus, theme at 375, drawing theme, fit and confirmations",
  );
}

async function checkBar(page: Page, emptyId: string, drawingId: string) {
  const pages = {
    Home: "/dashboard",
    document: `/documents/${emptyId}`,
    drawing: `/drawings/${drawingId}`,
    settings: "/profile",
  };
  for (const [width, height, gutter, barHeight] of [
    [375, 812, 16, 44],
    [768, 1024, 24, 48],
    [1280, 900, 32, 48],
  ] as const) {
    await page.setViewport({ width, height });
    const seen: Record<string, Awaited<ReturnType<typeof appBar>>> = {};
    for (const [name, path] of Object.entries(pages)) {
      await page.goto(`${appUrl}${path}`, { waitUntil: "networkidle2" });
      const bar = await appBar(page);
      seen[name] = bar;
      assert.equal(bar.bar?.top, 0, `${width} ${name}: the bar is at the top`);
      assert.equal(
        bar.bar?.height,
        barHeight,
        `${width} ${name}: the bar is ${barHeight}px`,
      );
      // A document on a phone trades them for a way back; its ⋯ holds both.
      const compact = width === 375 && name === "document";
      if (compact) {
        assert(bar.back?.visible, `${width} ${name}: a way back shows`);
        assert(!bar.account?.visible, `${width} ${name}: no account menu`);
        assert(!bar.theme?.visible, `${width} ${name}: no theme control`);
      } else {
        assert(
          bar.account?.visible,
          `${width} ${name}: the account menu shows`,
        );
        assert(bar.theme?.visible, `${width} ${name}: the theme control shows`);
      }
      assert(
        bar.pageWidth <= width,
        `${width} ${name}: nothing scrolls sideways`,
      );
      if (width > 375) {
        assert.equal(bar.crumbs[0], "Home", `${width} ${name}: Home leads`);
      }
    }
    const reference = seen.Home;
    for (const [name, bar] of Object.entries(seen)) {
      if (width === 375 && name === "document") continue;
      assert.equal(
        Math.round(bar.account?.right ?? 0),
        Math.round(reference?.account?.right ?? -1),
        `${width} ${name}: the account menu sits where it does on Home`,
      );
      if (width > 375)
        assert.equal(
          Math.round(bar.home?.left ?? 0),
          Math.round(reference?.home?.left ?? -1),
          `${width} ${name}: the breadcrumb starts where it does on Home`,
        );
    }
    const main = await page.$eval(APP_BAR, (bar) => {
      const logo = bar.querySelector("a");
      return (
        (logo?.getBoundingClientRect().left ?? 0) -
        bar.getBoundingClientRect().left
      );
    });
    assert.equal(
      main,
      gutter,
      `${width}: the bar keeps the ${gutter}px gutter`,
    );
  }

  // The account menu says who is signed in, and where to go.
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "networkidle2" });
  const account = await menuItems(
    page,
    `${APP_BAR} button[aria-label="Account"]`,
  );
  const header = await page.$eval(
    '[role="menu"]',
    (menu) => menu.textContent ?? "",
  );
  assert.match(header, /@/, "The account menu shows the email");
  for (const item of ["Home", "Settings", "Theme", "Sign out"])
    assert(
      account.some((text) => text.startsWith(item)),
      `The account menu offers ${item} (${account.join(", ")})`,
    );
  await page.keyboard.press("Escape");
}

/**
 * Home's Show switch at a desktop width, with a mouse and under a finger: its
 * segments sit inside their track, the current one no taller than the rest,
 * and under a finger each is a 44px target.
 */
export async function checkHomeToolbar(page: Page) {
  for (const hasTouch of [false, true]) {
    await page.setViewport({ width: 1280, height: 900, hasTouch });
    await page.goto(`${appUrl}/dashboard`, { waitUntil: "networkidle2" });
    const input = hasTouch ? "touch" : "mouse";
    const seen = await page.evaluate(() => {
      const track = document.querySelector(
        '[role="toolbar"][aria-label="Files and filters"] nav[aria-label="Show"]',
      );
      const box = (element: Element) => {
        const { top, bottom } = element.getBoundingClientRect();
        return { top: Math.round(top), bottom: Math.round(bottom) };
      };
      return {
        track: track ? box(track) : null,
        segments: [...(track?.querySelectorAll("a") ?? [])].map((link) => ({
          name: link.textContent ?? "",
          ...box(link),
        })),
      };
    });
    const { track } = seen;
    assert(
      track && seen.segments.length === 3,
      `${input}: Show has 3 segments`,
    );
    for (const segment of seen.segments) {
      assert(
        segment.top >= track.top && segment.bottom <= track.bottom,
        `${input}: ${segment.name} sits inside the Show track (${segment.top}..${segment.bottom} in ${track.top}..${track.bottom})`,
      );
      if (hasTouch)
        assert(
          segment.bottom - segment.top >= 44,
          `${input}: ${segment.name} is a 44px target`,
        );
    }
  }
  await page.setViewport({ width: 1280, height: 900, hasTouch: false });
}

/**
 * Settings scrolls as a page: the app bar stays on top, and what is held or
 * jumped to below it clears the bar by the same 2rem at every width.
 */
export async function checkSettings(page: Page) {
  for (const [width, height, barHeight] of [
    [375, 812, 44],
    [1280, 900, 48],
  ] as const) {
    await page.setViewport({ width, height });
    await page.goto(`${appUrl}/settings`, { waitUntil: "networkidle2" });
    await page.waitForSelector("section#settings-editor", { visible: true });
    await page.locator('aside a[href="#settings-editor"]').click();
    await pause(800);
    const seen = await page.evaluate(() => {
      const top = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect().top ?? null;
      return {
        scrollY: window.scrollY,
        bar: top('[data-component-name="AppBar"]'),
        section: top("section#settings-editor"),
        aside: top("aside > div"),
      };
    });
    assert(seen.scrollY > 0, `${width} settings: the jump scrolls the page`);
    assert.equal(seen.bar, 0, `${width} settings: the app bar stays on top`);
    assert.equal(
      Math.round(seen.section ?? 0),
      barHeight + 32,
      `${width} settings: a section jumped to clears the app bar by 2rem`,
    );
    if (width >= 768)
      assert.equal(
        Math.round(seen.aside ?? 0),
        barHeight + 32,
        `${width} settings: the held nav clears the app bar by 2rem`,
      );
  }
}

async function checkDocument(page: Page, emptyId: string) {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/documents/${emptyId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector('[id^="lexical-content-"]');
  await pause(500);
  assert.equal(
    await page.title(),
    "Visual suite · empty · Lexidraw",
    "The tab shows the document's title",
  );
  const bar = await appBar(page);
  assert.equal(bar.crumbs.at(-1), "Visual suite · empty");

  // Renaming in the breadcrumb renames the tab.
  await page.locator(`${APP_BAR} button[aria-label^="Rename"]`).click();
  const input = `${APP_BAR} input[aria-label="Title"]`;
  await page.waitForSelector(input);
  await page.$eval(input, (field) => (field as HTMLInputElement).select());
  await page.keyboard.type("Visual suite · renamed");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.title === "Visual suite · renamed · Lexidraw",
    { timeout: 5000 },
  );

  // Edit | Read.
  const modes = await page.$$eval(
    `${APP_BAR} fieldset input[type="radio"]`,
    (radios) =>
      (radios as HTMLInputElement[]).map((radio) => ({
        text: radio.closest("label")?.textContent?.trim(),
        checked: radio.checked,
      })),
  );
  assert.deepEqual(
    modes,
    [
      { text: "Edit", checked: true },
      { text: "Read", checked: false },
    ],
    "Edit | Read shows the current mode with labels",
  );

  // Reading, at any size, keeps its tools in the reading pill and has no
  // formatting strip; editing brings the strip back.
  const tools = (on = page) =>
    on.evaluate(() => {
      const shown = (element: Element | null) =>
        Boolean(element && element.getClientRects().length > 0);
      const pill = document.querySelector(
        '[role="toolbar"][aria-label="Reading"]',
      );
      const strip = document.querySelector(
        '[role="toolbar"][aria-label="Formatting"]',
      );
      return {
        formatting: shown(strip),
        // Groups in sight, not folded into More.
        groups: [
          ...(strip?.querySelectorAll("[data-toolbar-group]:not([inert])") ??
            []),
        ].filter(shown).length,
        pill: shown(pill)
          ? [...(pill?.querySelectorAll("button") ?? [])].map(
              (button) =>
                button.getAttribute("aria-label") ??
                button.textContent?.trim() ??
                "",
            )
          : null,
      };
    });
  const switchTo = async (label: "Edit" | "Read") => {
    await page.$$eval(
      `${APP_BAR} fieldset label`,
      (labels, label) =>
        (
          labels.find((option) => option.textContent?.trim() === label) as
            | HTMLElement
            | undefined
        )?.click(),
      label,
    );
    await pause(300);
  };
  for (const [width, height] of [
    [768, 1024],
    [1280, 900],
  ] as const) {
    await page.setViewport({ width, height });
    await switchTo("Read");
    const reading = await tools();
    assert(!reading.formatting, `${width}: reading has no formatting strip`);
    assert.deepEqual(
      reading.pill,
      ["Listen", "Play from cursor", "Contents"],
      `${width}: reading has the pill, with Listen and Contents`,
    );
    await switchTo("Edit");
    const editing = await tools();
    assert(editing.formatting, `${width}: editing has the formatting strip`);
    assert(
      editing.groups > 0,
      `${width}: the strip comes back with its controls after reading`,
    );
    assert.equal(editing.pill, null, `${width}: editing has no reading pill`);
  }

  // Signed out, a document anyone may read is read from the pill too, which
  // has only Contents: listening is for someone signed in.
  const setPublicAccess = (publicAccess: "READ" | "PRIVATE") =>
    page.evaluate(
      async (id, publicAccess) => {
        const response = await fetch("/api/trpc/entities.update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { id, publicAccess } }),
        });
        if (!response.ok) throw new Error(`update: ${response.status}`);
      },
      emptyId,
      publicAccess,
    );
  await setPublicAccess("READ");
  const signedOut = await page.browser().createBrowserContext();
  try {
    const visitor = await signedOut.newPage();
    for (const [width, height] of [
      [768, 1024],
      [1280, 900],
    ] as const) {
      await visitor.setViewport({ width, height });
      await visitor.goto(`${appUrl}/documents/${emptyId}`, {
        waitUntil: "networkidle2",
      });
      await visitor.waitForSelector('[id^="lexical-content-"]');
      await pause(300);
      const visiting = await tools(visitor);
      assert(
        !visiting.formatting,
        `${width}: signed out, there is no formatting strip`,
      );
      assert.deepEqual(
        visiting.pill,
        ["Contents"],
        `${width}: signed out, the pill has Contents alone`,
      );
    }
  } finally {
    await signedOut.close();
    await setPublicAccess("PRIVATE");
  }

  // Saving: typing is unsaved, then saving, then saved; Cmd+S saves now.
  const autoSaved = await setAutoSave(page, true);
  await recordStatus(page);
  await page.$eval('[id^="lexical-content-"]', (content) =>
    (content as HTMLElement).focus(),
  );
  await page.keyboard.type("Saved by the app bar");
  await page.waitForFunction(
    () => {
      const { said } = window as unknown as { said: string[] };
      return said.length > 1 && said.at(-1) === "Saved";
    },
    { timeout: 8000 },
  );
  const sequence = (await said(page)).slice(1);
  assert.deepEqual(
    sequence.filter((text, index) => sequence.indexOf(text) === index),
    ["Unsaved changes", "Saving…", "Saved"],
    `The status says what saving does (${sequence.join(" → ")})`,
  );
  await recordStatus(page);
  await page.keyboard.type(" again");
  await pressSave(page);
  await pause(400);
  assert(
    (await said(page)).includes("Saving…"),
    "Cmd/Ctrl+S saves before auto-save would",
  );

  // The ⋯ menu, grouped, Delete last.
  const items = await menuItems(
    page,
    `${APP_BAR} button[aria-label="Document actions"]`,
  );
  const grouped = groups(items);
  assert.deepEqual(
    grouped.map((group) =>
      group.map((text) => text.replace(/(⌘|Ctrl\+)S$/, "").trim()),
    ),
    [
      ["Save", "Share…", "Print…", "Export", "Import"],
      ["Rename…", "Tags…"],
      ["Auto-save"],
      ["Delete…"],
    ],
    `The ⋯ menu groups its actions (${items.join(", ")})`,
  );
  assert.match(items[0] ?? "", /S$/, "Save shows its shortcut");
  await page.keyboard.press("Escape");
  if (!autoSaved) await setAutoSave(page, false);

  // The theme, from the editor's ⋯ on a phone, one sheet down.
  await page.setViewport({ width: 375, height: 812 });
  await pause(300);
  const themeSheet = async () => {
    await menuItems(page, `${APP_BAR} button[aria-label="Document actions"]`);
    await choose(page, "Theme");
    await pause(300);
    return page.$$eval('[role="menuitemradio"]', (radios) =>
      radios.map((radio) => radio.textContent?.trim()),
    );
  };
  for (const choice of ["Dark", "Light"]) {
    await themeSheet();
    await choose(page, choice);
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    assert.equal(dark, choice === "Dark", `375: ${choice} applies`);
    const checked = await themeSheet();
    const marked = await page.$$eval(
      '[role="menuitemradio"][aria-checked="true"]',
      (radios) => radios.map((radio) => radio.textContent?.trim()),
    );
    assert.deepEqual(
      marked,
      [choice],
      `375: ${choice} is checked (${checked})`,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  }
}

/** The drawing editor a document opens over one of its drawings. */
async function checkEmbedded(page: Page, fixtureId: string) {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector('[id^="lexical-content-"]');
  const title = (await appBar(page)).crumbs.at(-1) ?? "";
  await page.evaluate(() => {
    const edit = [
      ...document.querySelectorAll<HTMLElement>(
        '[id^="lexical-content-"] button',
      ),
    ].find(
      (button) =>
        button.textContent?.trim() === "Edit" &&
        button.parentElement?.querySelector(".excalidraw-embed"),
    );
    if (!edit) throw new Error("Missing the drawing's Edit button");
    edit.click();
  });
  await page.waitForSelector(".excalidraw", { visible: true, timeout: 20_000 });
  await pause(800);
  const modal = await page.evaluate(() => {
    const dialog = document.querySelector(
      '[data-component-name="DrawingEditor"]',
    );
    return {
      text: dialog?.textContent ?? "",
      buttons: [...(dialog?.querySelectorAll("header button") ?? [])].map(
        (button) => button.textContent?.trim(),
      ),
    };
  });
  assert(
    title.length > 0 && modal.text.includes(title),
    "The drawing editor names its document",
  );
  assert.deepEqual(
    modal.buttons.slice(-2),
    ["Cancel", "Save & close"],
    "The drawing editor offers Cancel and Save & close",
  );
  const embeddedMenu = await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('[data-testid="main-menu-trigger"]')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return [
      ...document.querySelectorAll(
        ".dropdown-menu-container button, .dropdown-menu-container a",
      ),
    ].map((item) => item.textContent?.trim() ?? "");
  });
  assert(
    !embeddedMenu.some((text) => /^Open|^Clear canvas/.test(text)),
    `The embedded editor offers no Open or Clear canvas (${embeddedMenu.join(", ")})`,
  );
  await page.keyboard.press("Escape");
  // A rectangle, so there is something to lose.
  await page.locator('.excalidraw [data-testid="toolbar-rectangle"]').click();
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(650, 520, { steps: 5 });
  await page.mouse.up();
  await pause(300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await pause(300);
  assert.match(
    (await dialogText(page)) ?? "",
    /Discard/,
    "Escape with unsaved changes asks before discarding",
  );
  await clickButton(page, "Discard", '[role="alertdialog"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-component-name="DrawingEditor"]'),
    { timeout: 3000 },
  );
}

async function checkDrawing(page: Page, drawingId: string) {
  // A dark reader: the canvas is dark the first time it is on screen.
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.evaluateOnNewDocument(() => {
    const record = window as unknown as { firstCanvas?: string };
    new MutationObserver((_, observer) => {
      const canvas = document.querySelector(".excalidraw");
      if (!canvas) return;
      record.firstCanvas = canvas.className;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${appUrl}/drawings/${drawingId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector(".excalidraw canvas", { visible: true });
  await pause(1000);
  const first = await page.evaluate(
    () => (window as unknown as { firstCanvas?: string }).firstCanvas,
  );
  assert.match(
    first ?? "",
    /theme--dark/,
    "The drawing is dark from its first frame",
  );
  assert.equal(
    await page.title(),
    "Visual suite · drawing · Lexidraw",
    "The tab shows the drawing's title",
  );

  const frame = await page.evaluate((selector) => {
    const canvas = document.querySelector<HTMLElement>(".excalidraw");
    const bar = document.querySelector(selector);
    if (!canvas || !bar) throw new Error("Missing canvas or bar");
    const style = getComputedStyle(canvas);
    const root = getComputedStyle(document.documentElement);
    const rect = canvas.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      barBottom: bar.getBoundingClientRect().bottom,
      primary: style.getPropertyValue("--color-primary").trim(),
      appPrimary: root.getPropertyValue("--primary").trim(),
      font: style.getPropertyValue("--ui-font"),
      appFont: getComputedStyle(document.body).fontFamily,
      radius: style.getPropertyValue("--border-radius-lg").trim(),
      appRadius: root.getPropertyValue("--radius-lg").trim(),
      themeButton: [...canvas.querySelectorAll("button")].some((button) =>
        /theme/i.test(
          `${button.textContent} ${button.getAttribute("aria-label")}`,
        ),
      ),
      menuTrigger: Boolean(
        canvas.querySelector('[data-testid="main-menu-trigger"]'),
      ),
      pageWidth: document.documentElement.scrollWidth,
    };
  }, APP_BAR);
  assert.equal(
    frame.top,
    frame.barBottom,
    "The canvas starts under the app bar",
  );
  assert.equal(frame.bottom, 900, "The canvas fills the rest of the viewport");
  assert.equal(frame.width, 1280, "The canvas fills the width");
  assert(frame.pageWidth <= 1280, "Nothing scrolls sideways");
  assert.equal(
    frame.primary,
    frame.appPrimary,
    "Excalidraw's primary is the app's",
  );
  assert(
    frame.font.includes(frame.appFont.split(",")[0] ?? "?"),
    "Excalidraw uses the UI font",
  );
  assert.equal(
    frame.radius,
    frame.appRadius,
    "Excalidraw uses the app radius scale",
  );
  assert(!frame.themeButton, "No theme button is injected into the canvas");

  // Stored far from the origin: it opens with the shape in view.
  const red = await redPixels(page);
  assert(red > 500, `The off-screen shape opens in view (${red} red pixels)`);

  // The main menu, grouped, Delete last; destroying work asks first.
  const items = await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('[data-testid="main-menu-trigger"]')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const menu = document.querySelector(".dropdown-menu-container");
    // A separator is a rule: a child with no text and next to no height.
    return [...(menu?.querySelectorAll(":scope > *") ?? [])].map((item) =>
      !item.textContent?.trim() && item.getBoundingClientRect().height <= 2
        ? "|"
        : (item.textContent?.trim() ?? ""),
    );
  });
  const grouped = groups(items).map((group) =>
    group.map((text) => text.replace(/(⌘|Ctrl\+)S$/, "").trim()),
  );
  assert.deepEqual(
    grouped,
    [
      ["Back to Home"],
      [
        "Save",
        "Auto-save",
        "Open .excalidraw file…",
        "Download .excalidraw file",
        "Export image…",
      ],
      ["Rename…", "Tags…"],
      ["Clear canvas…", "Delete…"],
    ],
    `The drawing menu groups its actions (${items.join(", ")})`,
  );
  for (const [item, question] of [
    ["Clear canvas…", /Clear canvas/],
    ["Open .excalidraw file…", /Open/],
  ] as const) {
    await page.evaluate(async (item) => {
      const trigger = document.querySelector<HTMLElement>(
        '[data-testid="main-menu-trigger"]',
      );
      if (!document.querySelector(".dropdown-menu-container")) {
        trigger?.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const button = [
        ...document.querySelectorAll<HTMLElement>(
          ".dropdown-menu-container button",
        ),
      ].find((element) => element.textContent?.trim().startsWith(item));
      if (!button) throw new Error(`Missing ${item}`);
      button.click();
    }, item);
    await pause(400);
    assert.match(
      (await dialogText(page)) ?? "",
      question,
      `${item} asks before replacing the drawing`,
    );
    await clickButton(page, "Cancel", '[role="alertdialog"]');
    await pause(200);
  }
  assert((await redPixels(page)) > 500, "Cancelling keeps what was drawn");

  // Drawing is unsaved, then saving, then saved; Cmd+S saves it.
  await recordStatus(page);
  await page.locator('.excalidraw [data-testid="toolbar-rectangle"]').click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380, { steps: 5 });
  await page.mouse.up();
  await pause(200);
  await pressSave(page);
  await page.waitForFunction(
    () => {
      const { said } = window as unknown as { said: string[] };
      return said.length > 1 && said.at(-1) === "Saved";
    },
    { timeout: 8000 },
  );
  const drawingSaid = (await said(page)).slice(1);
  assert.deepEqual(
    drawingSaid.filter((text, index) => drawingSaid.indexOf(text) === index),
    ["Unsaved changes", "Saving…", "Saved"],
    `The drawing's status says what saving does (${drawingSaid.join(" → ")})`,
  );

  // Light again: the canvas follows.
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".excalidraw canvas", { visible: true });
  await pause(500);
  const light = await page.evaluate(
    () => (window as unknown as { firstCanvas?: string }).firstCanvas,
  );
  assert.doesNotMatch(
    light ?? "",
    /theme--dark/,
    "A light reader gets a light canvas",
  );
}
