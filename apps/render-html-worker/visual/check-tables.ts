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
  for (const table of tables) {
    assert(table.regionWidth >= 704);
    assert(table.width >= table.regionWidth - 2);
    assert.equal(table.role, "region");
    assert(table.label);
    assert.equal(table.tabIndex, 0);
    assert.equal(table.size, "15px");
    assert.equal(table.line, "22.5px");
  }
  assert.equal(Math.round(tables[2]?.regionWidth ?? 0), 1024);
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
    "Table layout: intrinsic sizing, numeric alignment, scroll region, pinned column",
  );
}
