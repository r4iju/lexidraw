import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "./check-typography";
import { appUrl } from "./app-url";

export async function checkTables(page: Page, fixtureId: string) {
  await signInToDev(page);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector(".document-content table");
  const tables = await page.$$eval(".document-content table", (tables) =>
    tables.map((table) => {
      const region = table.parentElement;
      const cell = table.querySelector("td");
      if (!region || !cell)
        throw new Error("Missing table cells or scroll region");
      return {
        left: table.getBoundingClientRect().left,
        width: table.getBoundingClientRect().width,
        regionWidth: region.getBoundingClientRect().width,
        role: region.getAttribute("role"),
        label: region.getAttribute("aria-label"),
        tabIndex: region.tabIndex,
        storedWidths: [...table.querySelectorAll("col")].some(
          (col) => col.style.width,
        ),
        size: getComputedStyle(cell).fontSize,
        line: getComputedStyle(cell).lineHeight,
      };
    }),
  );
  assert(tables.length >= 3);
  assert(
    tables.every((table) => !table.storedWidths),
    "Opening an unsized table must not write column widths",
  );
  const textLeft = await page.$eval(
    '[id^="lexical-content-"] > p',
    (paragraph) => paragraph.getBoundingClientRect().left,
  );
  for (const table of tables) {
    assert(table.regionWidth <= 1024.5, "A table grows no wider than 1024px");
    if (table.width < 704)
      assert(
        Math.abs(table.left - textLeft) < 1,
        `A table narrower than the text starts where it does: ${table.left} vs ${textLeft}`,
      );
    assert.equal(table.role, "region");
    assert(table.label);
    assert.equal(table.tabIndex, 0);
    assert.equal(table.size, "15px");
    assert.equal(table.line, "22.5px");
  }
  assert(
    (tables[1]?.width ?? 704) < 400,
    `A short table is as wide as its content: ${tables[1]?.width}`,
  );
  assert(
    (tables[2]?.regionWidth ?? 0) > 704 &&
      Math.abs((tables[2]?.width ?? 0) - (tables[2]?.regionWidth ?? 0)) < 1,
    `A table wider than the text grows past it before it wraps or scrolls: ${JSON.stringify(tables[2])}`,
  );
  const numeric = await page.$$eval(
    ".document-content table:nth-of-type(1)",
    () => {
      const table = [
        ...document.querySelectorAll(".document-content table"),
      ][2];
      if (!table) throw new Error("Missing wide table");
      return [...table.querySelectorAll("tr")].slice(1).map((row) => {
        const cell = row.children[3];
        if (!cell) throw new Error("Missing numeric cell");
        return getComputedStyle(cell).textAlign;
      });
    },
  );
  assert(
    numeric.every((value) => value === "right"),
    "80% numeric column aligns right",
  );
  await page.setViewport({ width: 375, height: 812 });
  const phone = await page.evaluate(() => {
    const table = [
      ...document.querySelectorAll<HTMLTableElement>(".document-content table"),
    ][2];
    if (!table) throw new Error("Missing wide table");
    const region = table.parentElement;
    const cell = table.rows[1]?.cells[0];
    if (!region || !cell) throw new Error("Missing pinned cell");
    const left = cell.getBoundingClientRect().left;
    region.scrollLeft = 200;
    return {
      left,
      scrolled: cell.getBoundingClientRect().left,
      overflow: region.scrollWidth > region.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert(phone.overflow);
  assert.equal(phone.left, phone.scrolled, "First column stays pinned");
  assert(!phone.pageOverflow);
  const measureWrapping = () =>
    page.evaluate(() => {
      /** How many lines the text between two offsets takes. */
      const lines = (cell: Element | undefined, from = 0, to?: number) => {
        const text =
          cell && document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const tops: number[] = [];
        let offset = 0;
        for (let node = text?.nextNode(); node; node = text?.nextNode()) {
          const length = node.textContent?.length ?? 0;
          const start = Math.max(from - offset, 0);
          const end = Math.min(
            (to ?? Number.POSITIVE_INFINITY) - offset,
            length,
          );
          if (start < end) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            for (const rect of range.getClientRects())
              if (rect.width > 0) tops.push(rect.top);
          }
          offset += length;
        }
        tops.sort((a, b) => a - b);
        return tops.filter(
          (top, index) => index === 0 || top - (tops[index - 1] ?? 0) > 8,
        ).length;
      };
      const [, keys, , modes] = [
        ...document.querySelectorAll<HTMLTableElement>(
          ".document-content table",
        ),
      ];
      if (!keys || !modes) throw new Error("Missing short tables");
      const heading = [
        ...document.querySelectorAll(".document-content h3"),
      ].find((element) => element.textContent?.includes("サーモン"));
      const title = heading?.textContent ?? "";
      const region = modes.parentElement;
      const deli = modes.rows[2]?.cells[1];
      const deliText = deli?.textContent ?? "";
      const bake = modes.rows[3]?.cells[2];
      const bakeText = bake?.textContent ?? "";
      return {
        overflow: [keys, modes].some(
          (table) =>
            (table.parentElement?.scrollWidth ?? 0) >
            (table.parentElement?.clientWidth ?? 0),
        ),
        width: region?.getBoundingClientRect().width,
        prose: lines(modes.rows[1]?.cells[1]),
        label: lines(modes.rows[2]?.cells[0]),
        kana: lines(modes.rows[2]?.cells[2]),
        han: lines(
          deli,
          deliText.indexOf("惣菜"),
          deliText.indexOf("惣菜") + 2,
        ),
        phrase: ["ベイク", "ロースト"].map((word) =>
          lines(
            bake,
            bakeText.indexOf(word),
            bakeText.indexOf(word) + word.length,
          ),
        ),
        tokens: [...keys.rows].slice(1).map((row) => lines(row.cells[1])),
        heading: ["サーモン", "レモンハーブグリル"].map((word) =>
          lines(
            heading,
            title.indexOf(word),
            title.indexOf(word) + word.length,
          ),
        ),
      };
    });
  const editing = await measureWrapping();
  assert(
    !editing.overflow,
    `Short tables fit a phone while editing: ${JSON.stringify(editing)}`,
  );
  // The corner kept for the cell menu shortens a first line while editing, so
  // where words break is read from the page a reader gets.
  const setEditable = async (editable: boolean) => {
    await page.evaluate((editable) => {
      const root = document.querySelector<
        HTMLElement & { __lexicalEditor?: { setEditable(on: boolean): void } }
      >(".document-content[contenteditable]");
      root?.__lexicalEditor?.setEditable(editable);
    }, editable);
    await page.waitForSelector(
      `.document-content[contenteditable="${editable}"]`,
    );
  };
  await setEditable(false);
  const wrapping = await measureWrapping();
  await setEditable(true);
  assert(
    !wrapping.overflow,
    `Short tables fit a phone: ${JSON.stringify(wrapping)}`,
  );
  assert(wrapping.prose > 1, "A sentence in a cell wraps");
  assert.equal(wrapping.label, 1, "A short label stays on one line");
  assert.equal(wrapping.kana, 1, "A Japanese word stays whole");
  assert.equal(wrapping.han, 1, "Kanji in English text stay together");
  assert.deepEqual(
    wrapping.phrase,
    [1, 1],
    "A long Japanese label gives way between its words, never inside one",
  );
  assert.deepEqual(
    wrapping.tokens,
    [1, 1],
    "claude-dev and 2026-09-24 never break",
  );
  assert.deepEqual(
    wrapping.heading,
    [1, 1],
    "A heading in an English document breaks Japanese between phrases",
  );
  await page.$eval(".document-content th", (cell) =>
    cell.scrollIntoView({ block: "center" }),
  );
  await page.click(".document-content th");
  await page.locator('button[aria-label="Table cell actions"]').click();
  await page.waitForFunction(() => {
    const menu = document.querySelector('[role="menu"]');
    return menu && getComputedStyle(menu).opacity === "1";
  });
  const menu = await page.$eval('[role="menu"]', (menu) => ({
    rect: menu.getBoundingClientRect().toJSON(),
    checks: [...menu.querySelectorAll('[role="menuitemcheckbox"]')].map(
      (item) => item.getAttribute("aria-checked"),
    ),
    items: [
      ...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'),
    ].map((item) => ({
      text: item.textContent?.trim(),
      bottom: item.getBoundingClientRect().bottom,
    })),
  }));
  assert(menu.rect.top >= 0 && menu.rect.bottom <= 812);
  assert(menu.rect.left >= 0 && menu.rect.right <= 375);
  assert.deepEqual(menu.checks, ["true", "false"]);
  assert(menu.items.every((item) => item.bottom <= menu.rect.bottom));
  assert.deepEqual(
    menu.items.slice(-3).map((item) => item.text),
    ["Delete column", "Delete row", "Delete table"],
  );
  await page.keyboard.press("Escape");
  await page.emulateMediaType("print");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  const print = await page.$$eval("table[data-print-table]", (tables) =>
    tables.map((table) => ({
      header: getComputedStyle(table.querySelector("thead") ?? table).display,
      split: getComputedStyle(table).breakInside,
      width: table.getBoundingClientRect().width,
      available: table.parentElement?.clientWidth ?? 0,
      rows: [...table.querySelectorAll("tr")].map(
        (row) => getComputedStyle(row).breakInside,
      ),
      borders: [...table.querySelectorAll("td,th")].map((cell) => {
        const style = getComputedStyle(cell);
        return [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ];
      }),
    })),
  );
  for (const table of print) {
    assert.equal(table.header, "table-header-group");
    assert.equal(table.split, "auto");
    assert(table.width <= table.available + 1, "Printed tables fit their page");
    assert(table.rows.every((value) => value === "avoid"));
    assert(
      table.borders.every((edges) =>
        edges.every((value) => Number.parseFloat(value) > 0),
      ),
      "Every printed cell keeps all four borders",
    );
  }
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMediaType("screen");
  console.log(
    "Table layout: content sizing, wrapping prose, numeric alignment, scroll region, pinned column",
  );
}
