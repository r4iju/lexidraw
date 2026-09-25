import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { $isTableNode, INSERT_TABLE_COMMAND } from "@lexical/table";
import { $findMatchingParent, $insertNodeToNearestRoot } from "@lexical/utils";
import { $createDocumentTable } from "@packages/lexical-nodes";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  setDOMUnmanaged,
} from "lexical";
import { useEffect } from "react";

const number =
  /^(?:[+-]?\s*(?:[$€£¥￥]|[A-Z]{3}\s)?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|円)?|\(\s*[$€£¥￥]?\d[\d,]*(?:\.\d+)?\s*\))$/u;

const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/**
 * About as many Latin letters as a label fits in: a column whose every cell
 * is this short (numbers, dates, names such as "claude-dev") stays on one line
 * while the table fits, so the columns holding sentences give way first.
 */
const SHORT_COLUMNS = 16;

/**
 * A table this wide scrolls on a phone whatever its cells do, and there a
 * label that stays whole reads better than one broken to fit.
 */
const SCROLLING_COLUMNS = 5;

const columnsWide = (text: string) =>
  [...text].reduce((width, char) => width + (WIDE.test(char) ? 2 : 1), 0);

const setWhole = (table: HTMLTableElement, column: number, whole: boolean) => {
  for (const row of table.rows)
    row.cells[column]?.toggleAttribute("data-whole", whole);
};

/** Short columns stay whole only while together they leave the table room to
 * fit; past that the widest gives way first, between its words. */
function fitShortColumns(
  table: HTMLTableElement,
  region: HTMLElement,
  short: readonly number[],
) {
  for (const column of short) setWhole(table, column, true);
  if ((table.rows[0]?.cells.length ?? 0) >= SCROLLING_COLUMNS) return;
  const whole = [...short];
  while (whole.length > 0 && table.offsetWidth > region.clientWidth) {
    const width = (column: number) =>
      table.rows[0]?.cells[column]?.offsetWidth ?? 0;
    whole.sort((a, b) => width(b) - width(a));
    setWhole(table, whole.shift() as number, false);
  }
}

export function DocumentTablesPlugin() {
  const [editor] = useLexicalComposerContext();

  // Lexical owns insertion; every authoring surface shares the same defaults.
  useEffect(
    () =>
      editor.registerCommand(
        INSERT_TABLE_COMMAND,
        ({ rows, columns }) => {
          const selection = $getSelection();
          if (
            $isRangeSelection(selection) &&
            $findMatchingParent(selection.anchor.getNode(), $isTableNode)
          )
            return true;
          const table = $createDocumentTable(Number(rows), Number(columns));
          $insertNodeToNearestRoot(table);
          table.selectStart();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  // DOM measurements and scroll hints are presentation, never editor-state writes.
  useEffect(() => {
    const cleanups = new Map<HTMLTableElement, () => void>();
    const shortColumns = new Map<HTMLTableElement, number[]>();
    const refresh = () => {
      const root = editor.getRootElement();
      for (const [table, cleanup] of cleanups) {
        if (!root?.contains(table)) {
          cleanup();
          cleanups.delete(table);
          shortColumns.delete(table);
        }
      }
      for (const table of root?.querySelectorAll<HTMLTableElement>("table") ??
        []) {
        if (table.dataset.printTable !== undefined) continue;
        const region = table.parentElement;
        if (!region?.classList.contains("document-table-region")) continue;
        region.setAttribute("role", "region");
        region.setAttribute("aria-label", "Table");
        region.tabIndex = 0;
        const rows = [...table.rows];
        const columns = rows[0]?.cells.length ?? 0;
        table.dataset.pinFirst = String(columns > 3);
        table.dataset.sized = String(
          Boolean(table.querySelector('col[style*="width"]')),
        );
        const short: number[] = [];
        for (let column = 0; column < columns; column++) {
          const cells = rows
            .map((row) => row.cells[column])
            .filter((cell) => cell !== undefined);
          const body = cells.filter((cell) => cell.tagName !== "TH");
          const numeric =
            !cells.some((cell) => cell.style.textAlign) &&
            body.length > 0 &&
            body.filter((cell) => number.test(cell.textContent?.trim() ?? ""))
              .length /
              body.length >=
              0.8;
          const isShort = cells.every(
            (cell) =>
              columnsWide(cell.textContent?.trim() ?? "") <= SHORT_COLUMNS,
          );
          for (const cell of cells) {
            cell.toggleAttribute("data-numeric", numeric);
            cell.toggleAttribute("data-short", isShort);
            cell.toggleAttribute("data-whole", false);
          }
          if (isShort) short.push(column);
        }
        shortColumns.set(table, short);
        fitShortColumns(table, region, short);
        if (cleanups.has(table)) continue;
        let fittedWidth = region.clientWidth;
        const updateScroll = () => {
          if (region.clientWidth !== fittedWidth) {
            fittedWidth = region.clientWidth;
            fitShortColumns(table, region, shortColumns.get(table) ?? []);
          }
          region.toggleAttribute("data-scroll-left", region.scrollLeft > 1);
          region.toggleAttribute(
            "data-scroll-right",
            region.scrollLeft + region.clientWidth < region.scrollWidth - 1,
          );
        };
        const observer = new ResizeObserver(updateScroll);
        observer.observe(table);
        observer.observe(region);
        region.addEventListener("scroll", updateScroll, { passive: true });
        cleanups.set(table, () => {
          observer.disconnect();
          region.removeEventListener("scroll", updateScroll);
        });
        updateScroll();
      }
    };
    const observer = new MutationObserver(refresh);
    const removeRoot = editor.registerRootListener((root) => {
      observer.disconnect();
      if (root)
        observer.observe(root, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      refresh();
    });
    const removeUpdate = editor.registerUpdateListener(refresh);
    const printCopies: HTMLElement[] = [];
    const beforePrint = () => {
      afterPrint();
      for (const table of cleanups.keys()) {
        // Lexical keeps rows directly under the table. A print-only copy can
        // group its header semantically without disturbing the live editor DOM.
        const copy = table.cloneNode(true) as HTMLTableElement;
        copy.dataset.printTable = "";
        setDOMUnmanaged(copy);
        copy.querySelector("colgroup")?.remove();
        for (const cell of copy.querySelectorAll<HTMLElement>("td, th"))
          cell.style.width = "";
        const first = copy.rows[0];
        if (first && [...first.cells].every((cell) => cell.tagName === "TH")) {
          copy.createTHead().append(first);
        }
        const body = copy.createTBody();
        for (const row of [...copy.rows])
          if (row.parentElement === copy) body.append(row);
        table.after(copy);
        const availableWidth = table.parentElement?.clientWidth ?? 0;
        const naturalWidth = copy.getBoundingClientRect().width;
        if (availableWidth > 0 && naturalWidth > availableWidth) {
          copy.style.width = `${naturalWidth}px`;
          copy.style.zoom = String(availableWidth / naturalWidth);
          // Zoom changes font and border rounding, so fit the resulting box too.
          const scaledWidth = copy.getBoundingClientRect().width;
          if (scaledWidth > availableWidth) {
            copy.style.zoom = String(
              (Number(copy.style.zoom) * availableWidth) / scaledWidth,
            );
          }
        }
        printCopies.push(copy);
      }
    };
    const afterPrint = () => {
      for (const copy of printCopies.splice(0)) copy.remove();
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      removeRoot();
      removeUpdate();
      observer.disconnect();
      for (const cleanup of cleanups.values()) cleanup();
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      afterPrint();
    };
  }, [editor]);
  return (
    <TablePlugin hasCellMerge hasCellBackgroundColor hasHorizontalScroll />
  );
}
