import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import {
  DOCUMENT_TABLE_LAYOUT,
  DOCUMENT_TABLE_PATTERNS,
  DOCUMENT_TABLE_PLUGIN,
  registerDocumentTableInsertion,
} from "@packages/lexical-nodes";
import { setDOMUnmanaged } from "lexical";
import { useEffect } from "react";

const { number, wide } = DOCUMENT_TABLE_PATTERNS;

const columnsWide = (text: string) =>
  [...text].reduce((width, char) => width + (wide.test(char) ? 2 : 1), 0);

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
  if (
    (table.rows[0]?.cells.length ?? 0) >= DOCUMENT_TABLE_LAYOUT.scrollingColumns
  )
    return;
  const whole = [...short];
  while (whole.length > 0 && table.offsetWidth > region.clientWidth) {
    const width = (column: number) =>
      table.rows[0]?.cells[column]?.offsetWidth ?? 0;
    whole.sort((a, b) => width(b) - width(a));
    setWhole(table, whole.shift() as number, false);
  }
}

/** Marks the cells whose spans reach the table's last row or column, which
 * `tr:last-child` and `:last-child` miss, so they draw no border against
 * the table's own. */
function markEdges(table: HTMLTableElement) {
  const taken: boolean[][] = [];
  const placed: { cell: HTMLTableCellElement; row: number; column: number }[] =
    [];
  [...table.rows].forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.cells) {
      while (taken[rowIndex]?.[column]) column++;
      placed.push({ cell, row: rowIndex, column });
      for (let r = rowIndex; r < rowIndex + cell.rowSpan; r++) {
        const spanned = taken[r] ?? [];
        for (let c = column; c < column + cell.colSpan; c++) spanned[c] = true;
        taken[r] = spanned;
      }
      column += cell.colSpan;
    }
  });
  const rows = table.rows.length;
  const columns = Math.max(0, ...taken.map((row) => row.length));
  for (const { cell, row, column } of placed) {
    cell.toggleAttribute("data-row-end", row + cell.rowSpan >= rows);
    cell.toggleAttribute("data-column-end", column + cell.colSpan >= columns);
  }
}

export function DocumentTablesPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerDocumentTableInsertion(editor), [editor]);

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
        markEdges(table);
        const rows = [...table.rows];
        const columns = rows[0]?.cells.length ?? 0;
        table.dataset.pinFirst = String(
          columns > DOCUMENT_TABLE_LAYOUT.unpinnedColumns,
        );
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
              columnsWide(cell.textContent?.trim() ?? "") <=
              DOCUMENT_TABLE_LAYOUT.shortColumns,
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
  return <TablePlugin {...DOCUMENT_TABLE_PLUGIN} />;
}
