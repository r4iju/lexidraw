import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

export async function signInToDev(page: Page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    if (request.url().includes("react-scan")) void request.abort();
    else void request.continue();
  });
  await page.goto(`${appUrl}/signin`, {
    waitUntil: "networkidle2",
  });
  const signedIn = await page.evaluate(async () => {
    const session = await fetch("/api/auth/session").then((response) =>
      response.json(),
    );
    return Boolean(session?.user);
  });
  if (signedIn) return;
  const credentials = Object.fromEntries(
    (await readFile(`${homedir()}/.lexidraw-dev-account`, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
  assert(credentials.email && credentials.password, "Missing dev credentials");
  await page.locator('input[name="email"]').fill(credentials.email);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname === "/dashboard");
}

export async function checkTypography(page: Page, fixtureId: string) {
  await page.bringToFront();
  await signInToDev(page);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector('[id^="lexical-content-"] > p > span');
  async function selectText(selector: string) {
    await page.$eval(selector, (element) => {
      const text = element.firstChild;
      if (!text) throw new Error("Missing text to select");
      element.closest<HTMLElement>("[contenteditable]")?.focus();
      window.getSelection()?.setBaseAndExtent(text, 0, text, 1);
    });
    await page.keyboard.press("ArrowRight");
  }
  await selectText('[id^="lexical-content-"] > h1 > span');
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Font size"]')
        ?.value === "30",
  );
  await selectText('[id^="lexical-content-"] > p > span');
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Font size"]')
        ?.value === "16",
  );
  const sizeInput = await page.$eval(
    'input[aria-label="Font size"]',
    (input) => ({
      width: input.getBoundingClientRect().width,
      spinner: getComputedStyle(input, "::-webkit-inner-spin-button")
        .appearance,
    }),
  );
  assert(sizeInput.width >= 48);
  assert.equal(sizeInput.spinner, "textfield");
  const measurements = await page.$eval(
    '[id^="lexical-content-"]',
    (content) => {
      const paragraph = content.querySelector("p");
      const firstHeading = content.querySelector("h1");
      if (!paragraph || !firstHeading)
        throw new Error("Missing prose or heading");
      return {
        width: paragraph.getBoundingClientRect().width,
        font: getComputedStyle(paragraph).fontFamily,
        size: getComputedStyle(paragraph).fontSize,
        line: getComputedStyle(paragraph).lineHeight,
        synthesis: getComputedStyle(content).fontSynthesis,
        headings: [...content.querySelectorAll("h1,h2,h3,h4,h5,h6")]
          .slice(0, 6)
          .map((heading) => getComputedStyle(heading).fontSize),
        firstHeadingGap: getComputedStyle(firstHeading).marginTop,
        codeWidth: content
          .querySelector(".document-code")
          ?.getBoundingClientRect().width,
        loadedFonts: [...document.fonts]
          .filter((font) => font.status === "loaded")
          .map((font) => font.family),
      };
    },
  );
  assert.equal(measurements.width, 704);
  assert.equal(measurements.size, "16px");
  assert.equal(measurements.line, "25.6px");
  assert.equal(measurements.synthesis, "none");
  assert(!measurements.font.includes("Fredoka"));
  assert.deepEqual(measurements.headings, [
    "30px",
    "24px",
    "20px",
    "17px",
    "16px",
    "14px",
  ]);
  assert.equal(measurements.firstHeadingGap, "0px");
  assert.equal(measurements.codeWidth, 1024);
  assert(
    !measurements.loadedFonts.some((font) =>
      /Inter|M PLUS|Yusei|Kosugi|Sawarabi/.test(font),
    ),
    "Unused font families must not download",
  );

  const cjk = await page.$eval('[id^="lexical-content-"]', (content) => {
    content.setAttribute("lang", "ja");
    const heading = content.querySelector("h1");
    const emphasis = content.querySelector("em");
    if (!heading || !emphasis) throw new Error("Missing CJK samples");
    const result = {
      line: getComputedStyle(content).lineHeight,
      spacing: getComputedStyle(content).letterSpacing,
      breaking: getComputedStyle(content).lineBreak,
      headingBreak: getComputedStyle(heading).wordBreak,
      italic: getComputedStyle(emphasis).fontStyle,
      weight: getComputedStyle(emphasis).fontWeight,
    };
    content.setAttribute("lang", "en");
    return result;
  });
  assert.deepEqual(cjk, {
    line: "28.8px",
    spacing: "0.32px",
    breaking: "strict",
    headingBreak: "auto-phrase",
    italic: "italic",
    weight: "400",
  });

  const narrow = await page.$eval("#main-content", (main) => {
    main.style.width = "600px";
    const heading = main.querySelector("h1");
    if (!heading) throw new Error("Missing heading");
    const size = getComputedStyle(heading).fontSize;
    main.style.removeProperty("width");
    return size;
  });
  assert.equal(
    narrow,
    "26px",
    "Typography must respond to a narrowed container",
  );
  await page.emulateMediaType("print");
  const print = await page.$eval('[id^="lexical-content-"]', (content) => {
    const heading = content.querySelector("h1");
    if (!heading) throw new Error("Missing heading");
    return {
      size: getComputedStyle(content).fontSize,
      line: getComputedStyle(content).lineHeight,
      after: getComputedStyle(heading).breakAfter,
      inside: getComputedStyle(heading).breakInside,
    };
  });
  assert.deepEqual(print, {
    size: "14px",
    line: "21px",
    after: "avoid",
    inside: "avoid",
  });
  await page.emulateMediaType("screen");
  console.log("Typography", { measurements, cjk, print });
}

export async function checkDocumentSettings(page: Page, fixtureId: string) {
  // The saved dev fixture can still trigger the editor's navigation guard.
  page.on("dialog", async (dialog) => {
    assert.equal(dialog.type(), "beforeunload");
    await dialog.accept();
  });
  async function clickText(text: string, selector: string) {
    await page.waitForFunction(
      (text, selector) =>
        [...document.querySelectorAll(selector)].some(
          (element) => element.textContent?.trim() === text,
        ),
      {},
      text,
      selector,
    );
    for (const element of await page.$$(selector)) {
      if (
        (await element.evaluate((node) => node.textContent?.trim())) === text
      ) {
        await element.click();
        return;
      }
    }
    throw new Error(`Missing ${text}`);
  }
  async function choose(face: string, lang: string) {
    await page
      .locator('[aria-label="Formatting options for font family"]')
      .click();
    await clickText(`Document: ${face}`, '[role="menuitem"]');
    await page.waitForSelector('[role="menu"]', { hidden: true });
    await page
      .locator('[aria-label="Formatting options for font family"]')
      .click();
    await clickText("Document language…", '[role="menuitem"]');
    await page.select("#document-language", lang);
    await clickText("Apply", "button");
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("entities.save") && response.status() === 200,
    );
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(modifier);
    await page.keyboard.press("s");
    await page.keyboard.up(modifier);
    await saved;
    await page.waitForSelector('[data-save-status="saved"]');
  }
  await choose("serif", "ja");
  const response = await page.goto(`${appUrl}/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  assert(response);
  const html = await response.text();
  assert(html.includes('lang="ja"'));
  assert(html.includes("--doc-font-serif"));
  await page.waitForSelector('[id^="lexical-content-"] > p');
  const saved = await page.$eval('[id^="lexical-content-"]', (element) => ({
    lang: element.lang,
    font: getComputedStyle(element).fontFamily,
  }));
  assert.equal(saved.lang, "ja");
  assert(saved.font.includes("Charter"));
  await choose("sans", "");
  console.log("Document font and language survive a save and reload");
}
