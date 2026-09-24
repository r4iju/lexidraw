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
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalNode,
} from "lexical";
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
const TABLE_ROW_DIVIDER_REG_EXP = /^(\|\s*:?-{3,}:?\s*)+\|\s*$/;

export function createTableTransformer(
  transformers: TransformerSource,
): ElementTransformer {
  const $createTableCell = (textContent: string): TableCellNode => {
    // The export pads every cell with a space on either side. Keeping that
    // padding as content would widen the cell by one space on each round
    // trip, so it is stripped before the escaped newlines are restored.
    textContent = textContent.trim().replace(/\\n/g, "\n");
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

      const output: string[] = [];
      for (const [index, row] of node.getChildren().entries()) {
        if (!$isTableRowNode(row)) continue;
        const cells = row.getChildren().filter($isTableCellNode);
        output.push(
          `| ${cells
            .map((cell) =>
              $convertToMarkdownString(transformers(), cell)
                .replace(/\|/g, "\\|")
                .replace(/\n/g, "\\n"),
            )
            .join(" | ")} |`,
        );
        if (index === 0) {
          output.push(
            `| ${cells
              .map((cell) => {
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
              })
              .join(" | ")} |`,
          );
        }
      }

      return output.join("\n");
    },
    regExp: TABLE_ROW_REG_EXP,
    replace: (parentNode, _1, match) => {
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

        // Remove line
        parentNode.remove();
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
      } else {
        parentNode.replace(table);
      }

      table.selectEnd();
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
    EMOJI,
    CHECK_LIST,
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
