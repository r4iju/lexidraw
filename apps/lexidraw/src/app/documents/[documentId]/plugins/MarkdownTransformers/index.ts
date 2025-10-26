import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
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
} from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
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

import { EquationNode } from "../../nodes/EquationNode";
import { ImageNode } from "../../nodes/ImageNode/ImageNode";
import { TweetNode } from "../../nodes/TweetNode";
import { ArticleNode } from "../../nodes/ArticleNode/ArticleNode";
import { htmlToPlainText } from "~/lib/html-to-text";
import { CollapsibleContainerNode } from "../CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "../CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "../CollapsiblePlugin/CollapsibleTitleNode";
import emojiList from "../../utils/emoji-list";

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

export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!ImageNode.$isImageNode(node)) {
      return null;
    }

    return `![${node.getAltText()}](${node.getSrc()})`;
  },
  importRegExp: /!(?:\[([^[]*)\])(?:\(([^(]+)\))/,
  regExp: /!(?:\[([^[]*)\])(?:\(([^(]+)\))$/,
  replace: (textNode, match) => {
    const [, altText, src] = match;
    const imageNode = ImageNode.$createImageNode({
      altText: altText as string,
      maxWidth: 800,
      src: src as string,
    });
    textNode.replace(imageNode);
  },
  trigger: ")",
  type: "text-match",
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

export const EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!EquationNode.$isEquationNode(node)) {
      return null;
    }

    return `$${node.getEquation()}$`;
  },
  importRegExp: /\$([^$]+?)\$/,
  regExp: /\$([^$]+?)\$$/,
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = EquationNode.$createEquationNode(equation, true);
    textNode.replace(equationNode);
  },
  trigger: "$",
  type: "text-match",
};

export const ARTICLE: ElementTransformer = {
  dependencies: [ArticleNode],
  export: (node: LexicalNode) => {
    if (!ArticleNode.$isArticleNode(node)) return null;
    const data = node.getData();
    if (data.mode === "url") {
      const title = data.distilled.title || "Article";
      const body = htmlToPlainText(data.distilled.contentHtml || "");
      const source = data.url ? `\n\n[Source](${data.url})` : "";
      return `### ${title}${source}\n\n${body}`;
    }
    // entity mode
    const snap = data.snapshot;
    if (snap?.contentHtml) {
      const title = snap.title || "Article";
      const body = htmlToPlainText(snap.contentHtml || "");
      const source = data.entityId ? `\n\n[Saved](/urls/${data.entityId})` : "";
      return `### ${title}${source}\n\n${body}`;
    }
    return `Article: ${data.entityId}`;
  },
  // Minimal, no-op import behavior (we don't import articles from markdown)
  regExp: /^<article\s+.*?>$/,
  replace: (textNode) => {
    textNode.replace($createTextNode("Article"));
  },
  type: "element",
};

// Passthrough transformers for collapsible nodes so children serialize normally
export const COLLAPSIBLE_CONTAINER: ElementTransformer = {
  dependencies: [CollapsibleContainerNode],
  export: (node) => {
    return CollapsibleContainerNode.$isCollapsibleContainerNode(node)
      ? $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, node)
      : null;
  },
  regExp: /^<collapsible-container>$/,
  replace: () => {},
  type: "element",
};

export const COLLAPSIBLE_CONTENT: ElementTransformer = {
  dependencies: [CollapsibleContentNode],
  export: (node) => {
    return CollapsibleContentNode.$isCollapsibleContentNode(node)
      ? $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, node)
      : null;
  },
  regExp: /^<collapsible-content>$/,
  replace: () => {},
  type: "element",
};

export const COLLAPSIBLE_TITLE: ElementTransformer = {
  dependencies: [CollapsibleTitleNode],
  export: (node) => {
    return CollapsibleTitleNode.$isCollapsibleTitleNode(node)
      ? $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, node)
      : null;
  },
  regExp: /^<collapsible-title>$/,
  replace: () => {},
  type: "element",
};

export const TWEET: ElementTransformer = {
  dependencies: [TweetNode],
  export: (node) => {
    if (!TweetNode.$isTweetNode(node)) {
      return null;
    }

    return `<tweet id="${node.getId()}" />`;
  },
  regExp: /<tweet id="([^"]+?)"\s?\/>\s?$/,
  replace: (textNode, _1, match) => {
    const [, id] = match;
    if (!id) return;
    const tweetNode = TweetNode.$createTweetNode(id);
    textNode.replace(tweetNode);
  },
  type: "element",
};

// Very primitive table setup
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-*:? ?)+\|\s?$/;

export const TABLE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node: LexicalNode) => {
    if (!$isTableNode(node)) {
      return null;
    }

    const output: string[] = [];

    for (const row of node.getChildren()) {
      const rowOutput = [];
      if (!$isTableRowNode(row)) {
        continue;
      }

      let isHeaderRow = false;
      for (const cell of row.getChildren()) {
        // It's TableCellNode so it's just to make flow happy
        if ($isTableCellNode(cell)) {
          rowOutput.push(
            $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, cell).replace(
              /\n/g,
              "\\n",
            ),
          );
          if (cell.__headerState === TableCellHeaderStates.ROW) {
            isHeaderRow = true;
          }
        }
      }

      output.push(`| ${rowOutput.join(" | ")} |`);
      if (isHeaderRow) {
        output.push(`| ${rowOutput.map((_) => "---").join(" | ")} |`);
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
      for (const cell of lastRow.getChildren()) {
        if (!$isTableCellNode(cell)) {
          return;
        }
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

    const table = $createTableNode();

    for (const cells of rows) {
      const tableRow = $createTableRowNode();
      table.append(tableRow);

      for (let i = 0; i < maxCells; i++) {
        tableRow.append(
          i < cells.length ? (cells[i] as TableCellNode) : $createTableCell(""),
        );
      }
    }

    const previousSibling = parentNode.getPreviousSibling();
    if (
      $isTableNode(previousSibling) &&
      getTableColumnsSize(previousSibling) === maxCells
    ) {
      previousSibling.append(...table.getChildren());
      parentNode.remove();
    } else {
      parentNode.replace(table);
    }

    table.selectEnd();
  },
  type: "element",
};

function getTableColumnsSize(table: TableNode) {
  const row = table.getFirstChild();
  return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

const $createTableCell = (textContent: string): TableCellNode => {
  textContent = textContent.replace(/\\n/g, "\n");
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  $convertFromMarkdownString(textContent, PLAYGROUND_TRANSFORMERS, cell);
  return cell;
};

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
  const match = textContent.match(TABLE_ROW_REG_EXP);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].split("|").map((text) => $createTableCell(text));
};

export const PLAYGROUND_TRANSFORMERS: Transformer[] = [
  COLLAPSIBLE_TITLE,
  COLLAPSIBLE_CONTENT,
  COLLAPSIBLE_CONTAINER,
  ARTICLE,
  TABLE,
  HR,
  IMAGE,
  EMOJI,
  EQUATION,
  TWEET,
  CHECK_LIST,
  ...ELEMENT_TRANSFORMERS,
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
];
