import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { HorizontalRuleNode } from "@lexical/extension";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";
import { AutocompleteNode } from "./nodes/AutocompleteNode.js";
import { CollapsibleContainerNode } from "./nodes/CollapsibleContainerNode.js";
import { CollapsibleContentNode } from "./nodes/CollapsibleContentNode.js";
import { CollapsibleTitleNode } from "./nodes/CollapsibleTitleNode.js";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode.js";
import { LayoutItemNode } from "./nodes/LayoutItemNode.js";

/**
 * The node classes the document editor registers that have no React
 * component. The browser editor registers these plus its decorator nodes;
 * the server's headless editor registers exactly these, so a document is
 * readable as markdown iff every node type it stores is in this list (or a
 * Lexical built-in). Nodes the editor does not register (emoji, keyword,
 * mention) are exported by the package but deliberately absent here.
 */
export const CORE_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  HorizontalRuleNode,
  MarkNode,
  CodeNode,
  CodeHighlightNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  AutocompleteNode,
  LinkNode,
  AutoLinkNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  LayoutContainerNode,
  LayoutItemNode,
];
