import { DocumentCodeNode } from "./nodes/DocumentCodeNode.js";
import { $createDocumentTable } from "./tables.js";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  CODE,
  type MultilineElementTransformer,
  ELEMENT_TRANSFORMERS,
  type ElementTransformer,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/extension";
import {
  $computeTableMapSkipCellCheck,
  $createTableCellNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
  type ListType,
} from "@lexical/list";
import {
  $createTextNode,
  $isParagraphNode,
  $isRootOrShadowRoot,
  $isTextNode,
  type LexicalNode,
} from "lexical";
import { $toggleOfTitle } from "./toggle.js";
import { DECORATOR_TRANSFORMERS } from "./decorator-transformers.js";
import {
  FOOTNOTE_DEFINITION,
  FOOTNOTE_REFERENCE,
} from "./footnote-transformers.js";
import emojiList from "./emoji-list.js";
import {
  createAdmonitionTransformer,
  createCalloutTransformer,
  createColumnsTransformer,
  createDetailsTransformer,
  TOGGLE_SHORTCUT,
  type TransformerSource,
} from "./block-transformers.js";

export const HR: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? "***" : null;
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _1, _2, isImport) => {
    const line = $createHorizontalRuleNode();

    // TODO: Get rid of isImport flag
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
    }

    line.selectNext();
  },
  type: "element",
};

/**
 * `---` on a line of its own, made a divider the moment the third dash is
 * typed, as Notion does. `HR` alone would wait for a space after it. The
 * caret stays on the line, which is left empty after the divider.
 */
export const HR_TYPED: TextMatchTransformer = {
  dependencies: [HorizontalRuleNode],
  export: () => null,
  regExp: /^---$/,
  replace: (textNode) => {
    const line = textNode.getParent();
    if (
      !$isParagraphNode(line) ||
      line.getTextContent() !== "---" ||
      !$isRootOrShadowRoot(line.getParent()) ||
      $toggleOfTitle(line)
    )
      return;
    textNode.remove();
    line.insertBefore($createHorizontalRuleNode());
    line.select();
  },
  trigger: "-",
  type: "text-match",
};

/**
 * `[ ] ` or `[x] ` at the start of a bullet makes it a check item, so that
 * `- [ ] ` gives one: `CHECK_LIST` only reads a line that is not yet a list,
 * and `- ` has already made a bullet of it.
 */
export const CHECK_ITEM_IN_BULLET: TextMatchTransformer = {
  dependencies: [ListNode, ListItemNode],
  export: () => null,
  regExp: /^\[(\s|x)?\]\s$/i,
  replace: (textNode, match) => {
    const item = textNode.getParent();
    const list = item?.getParent();
    if (
      !$isListItemNode(item) ||
      !$isListNode(list) ||
      list.getListType() !== "bullet" ||
      item.getFirstChild() !== textNode
    )
      return;
    textNode.remove();
    $retypeListItem(item, "check");
    item.setChecked(/^x$/i.test(match[1] ?? ""));
    item.selectStart();
  },
  trigger: " ",
  type: "text-match",
};

/**
 * Moves `item` into a list of `type` of its own, in place, splitting the
 * list it was in around it, and joins that to a list of `type` beside it.
 */
function $retypeListItem(item: ListItemNode, type: ListType) {
  const list = item.getParent();
  if (!$isListNode(list)) return;
  // A sublist lives in an item of its own, so its pieces go in one each.
  const nested = $isListItemNode(list.getParent());
  const place = (after: LexicalNode, piece: ListNode) =>
    nested
      ? after.insertAfter($createListItemNode().append(piece))
      : after.insertAfter(piece);
  const holder: LexicalNode = nested ? list.getParentOrThrow() : list;
  const later = item.getNextSiblings();
  const retyped = $createListNode(type);
  const placed = place(holder, retyped);
  if (later.length > 0) {
    const rest = $createListNode(list.getListType());
    rest.append(...later);
    place(placed, rest);
  }
  // `append` moves the item without moving the caret out of it.
  retyped.append(item);
  if (list.isEmpty()) holder.remove();
  if (nested) return;
  const before = retyped.getPreviousSibling();
  if ($isListNode(before) && before.getListType() === type) {
    before.append(...retyped.getChildren());
    retyped.remove();
  }
}

export const EMOJI: TextMatchTransformer = {
  dependencies: [],
  export: () => null,
  importRegExp: /:([a-z0-9_]+):/,
  regExp: /:([a-z0-9_]+):$/,
  replace: (textNode, [, name]) => {
    const emoji = emojiList.find((e) =>
      e.aliases.includes(name as string),
    )?.emoji;
    if (emoji) {
      textNode.replace($createTextNode(emoji));
    }
  },
  trigger: ":",
  type: "text-match",
};

const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
/**
 * A GFM row is one line, so a cell's own line breaks, between its blocks or
 * inside one, are written as the HTML break GFM readers show as one.
 */
const CELL_LINE_BREAK = /<br\s*\/?>/gi;
/** A GFM table's divider row, which makes the row above it the header. */
export const TABLE_ROW_DIVIDER_REG_EXP = /^(\|\s*:?-{3,}:?\s*)+\|\s*$/;

export function createTableTransformer(
  transformers: TransformerSource,
): ElementTransformer {
  const $createTableCell = (textContent: string): TableCellNode => {
    // The export pads every cell with a space on either side. Keeping that
    // padding as content would widen the cell by one space on each round
    // trip, so it is stripped before the line breaks are restored.
    textContent = textContent.trim().replace(CELL_LINE_BREAK, "\n");
    const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
    $convertFromMarkdownString(textContent, transformers(), cell);
    return cell;
  };

  const mapToTableCells = (textContent: string): TableCellNode[] | null => {
    const match = textContent.match(TABLE_ROW_REG_EXP);
    if (!match?.[1]) {
      return null;
    }
    return match[1]
      .split(/(?<!\\)\|/)
      .map((text) => $createTableCell(text.replace(/\\\|/g, "|")));
  };

  return {
    dependencies: [TableNode, TableRowNode, TableCellNode],
    export: (node: LexicalNode) => {
      if (!$isTableNode(node)) {
        return null;
      }

      // GFM has no merged cells, so a merged cell's content takes the first
      // place it covers and the rest stay empty, keeping every row as wide.
      const [grid] = $computeTableMapSkipCellCheck(node, null, null);
      const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
      const output = grid.map((places, r) =>
        row(
          places.map(({ cell, startRow, startColumn }, c) =>
            startRow === r && startColumn === c
              ? $convertToMarkdownString(transformers(), cell)
                  .replace(/\|/g, "\\|")
                  .replace(/\n/g, "<br>")
              : "",
          ),
        ),
      );
      output.splice(
        1,
        0,
        row(
          (grid[0] ?? []).map(({ cell }) => {
            switch (cell.getFormatType()) {
              case "left":
                return ":---";
              case "center":
                return ":---:";
              case "right":
                return "---:";
              default:
                return "---";
            }
          }),
        ),
      );
      return output.join("\n");
    },
    regExp: TABLE_ROW_REG_EXP,
    replace: (parentNode, children, match, isImport) => {
      // No table goes inside a table, as the insert handler has it. The
      // importer strips the match from the line before asking and does not
      // put it back on a cancel.
      if ($isTableCellNode(parentNode.getParent())) {
        const [textNode] = children;
        if (isImport && $isTextNode(textNode)) {
          textNode.setTextContent(match[0] ?? "");
        }
        return false;
      }
      // Header row
      if (TABLE_ROW_DIVIDER_REG_EXP.test(match[0] as string)) {
        const table = parentNode.getPreviousSibling();
        if (!table || !$isTableNode(table)) {
          return;
        }

        const rows = table.getChildren();
        const lastRow = rows[rows.length - 1];
        if (!lastRow || !$isTableRowNode(lastRow)) {
          return;
        }

        // Add header state to row cells
        for (const [index, cell] of lastRow.getChildren().entries()) {
          if (!$isTableCellNode(cell)) {
            return;
          }
          const delimiter = match[0]?.split("|")[index + 1]?.trim() ?? "";
          cell.setFormat(
            delimiter.startsWith(":")
              ? delimiter.endsWith(":")
                ? "center"
                : "left"
              : delimiter.endsWith(":")
                ? "right"
                : "",
          );
          cell.setHeaderStyles(
            TableCellHeaderStates.ROW,
            TableCellHeaderStates.ROW,
          );
        }

        parentNode.remove();
        table.selectEnd();
        return;
      }

      const matchCells = mapToTableCells(match[0] as string);

      if (matchCells == null) {
        return;
      }

      const rows = [matchCells];
      let sibling = parentNode.getPreviousSibling();
      let maxCells = matchCells.length;

      while (sibling) {
        if (!$isParagraphNode(sibling)) {
          break;
        }

        if (sibling.getChildrenSize() !== 1) {
          break;
        }

        const firstChild = sibling.getFirstChild();

        if (!$isTextNode(firstChild)) {
          break;
        }

        const cells = mapToTableCells(firstChild.getTextContent());

        if (cells == null) {
          break;
        }

        maxCells = Math.max(maxCells, cells.length);
        rows.unshift(cells);
        const previousSibling = sibling.getPreviousSibling();
        sibling.remove();
        sibling = previousSibling;
      }

      const table = $createDocumentTable(rows.length, maxCells);
      table.getChildren<TableRowNode>().forEach((tableRow, rowIndex) => {
        const cells = rows[rowIndex] ?? [];
        tableRow.clear();
        for (let i = 0; i < maxCells; i++) {
          tableRow.append(cells[i] ?? $createTableCell(""));
        }
      });

      const previousSibling = parentNode.getPreviousSibling();
      if (
        $isTableNode(previousSibling) &&
        getTableColumnsSize(previousSibling) === maxCells
      ) {
        const headerCells = previousSibling
          .getFirstChild<TableRowNode>()
          ?.getChildren<TableCellNode>();
        for (const row of table.getChildren<TableRowNode>()) {
          row.getChildren<TableCellNode>().forEach((cell, index) => {
            cell.setFormat(headerCells?.[index]?.getFormatType() ?? "");
          });
        }
        previousSibling.append(...table.getChildren());
        parentNode.remove();
        previousSibling.selectEnd();
      } else {
        parentNode.replace(table);
        table.selectEnd();
      }
    },
    type: "element",
  };
}

function getTableColumnsSize(table: TableNode) {
  const row = table.getFirstChild();
  return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

const DOCUMENT_CODE: MultilineElementTransformer = {
  ...CODE,
  dependencies: [DocumentCodeNode],
  handleImportAfterStartMatch(args) {
    const result = CODE.handleImportAfterStartMatch?.(args);
    const node = args.rootNode.getLastChild();
    if (node instanceof DocumentCodeNode) {
      if (node.getLanguage() === "showLineNumbers") node.setLanguage(undefined);
      node.setShowLineNumbers(
        /(?:^|\s)showLineNumbers(?:\s|$)/.test(
          (args.lines[args.startLineIndex] ?? "").replace(/^\s*`{3,}/, ""),
        ),
      );
    }
    return result ?? null;
  },
  export(node, ...args) {
    const markdown = CODE.export?.(node, ...args);
    if (!markdown || !(node instanceof DocumentCodeNode))
      return markdown ?? null;
    const [info = "", ...lines] = markdown.split("\n");
    const clean = info.replace(/\s+showLineNumbers\b/g, "");
    return [
      clean +
        (node.getShowLineNumbers()
          ? `${node.getLanguage() ? " " : ""}showLineNumbers`
          : ""),
      ...lines,
    ].join("\n");
  },
};

/**
 * The full transformer list for an editor. `extra` holds transformers for
 * nodes this package does not know; nested conversions inside tables,
 * callouts, collapsibles and columns see the complete list.
 */
export function createTransformers(extra: Transformer[] = []): Transformer[] {
  const all: Transformer[] = [];
  const source: TransformerSource = () => all;
  all.push(
    createCalloutTransformer(source),
    createAdmonitionTransformer(source),
    createDetailsTransformer(source),
    createColumnsTransformer(source),
    ...DECORATOR_TRANSFORMERS.multiline,
    ...DECORATOR_TRANSFORMERS.element,
    ...DECORATOR_TRANSFORMERS.textMatch,
    FOOTNOTE_DEFINITION,
    FOOTNOTE_REFERENCE,
    ...extra,
    createTableTransformer(source),
    HR,
    HR_TYPED,
    EMOJI,
    CHECK_LIST,
    CHECK_ITEM_IN_BULLET,
    TOGGLE_SHORTCUT,
    ...ELEMENT_TRANSFORMERS,
    ...MULTILINE_ELEMENT_TRANSFORMERS.map((transformer) =>
      transformer === CODE ? DOCUMENT_CODE : transformer,
    ),
    ...TEXT_FORMAT_TRANSFORMERS,
    ...TEXT_MATCH_TRANSFORMERS,
  );
  return all;
}

/** Transformers for the headless server editor, which registers CORE_NODES only. */
export const CORE_TRANSFORMERS: Transformer[] = createTransformers();
