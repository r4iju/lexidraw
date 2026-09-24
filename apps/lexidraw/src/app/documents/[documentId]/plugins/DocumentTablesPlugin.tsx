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
    const refresh = () => {
      const root = editor.getRootElement();
      for (const [table, cleanup] of cleanups) {
        if (!root?.contains(table)) {
          cleanup();
          cleanups.delete(table);
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
          for (const cell of cells)
            cell.toggleAttribute("data-numeric", numeric);
        }
        if (cleanups.has(table)) continue;
        const updateScroll = () => {
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
