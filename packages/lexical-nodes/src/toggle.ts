import {
  $createHeadingNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  $createParagraphNode,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { CollapsibleContainerNode } from "./nodes/CollapsibleContainerNode.js";
import { CollapsibleContentNode } from "./nodes/CollapsibleContentNode.js";
import { CollapsibleTitleNode } from "./nodes/CollapsibleTitleNode.js";

/** What a toggle's title is: a paragraph, or a heading of some level. */
export type ToggleLevel = "paragraph" | HeadingTagType;

const { $isCollapsibleContainerNode } = CollapsibleContainerNode;
const { $isCollapsibleTitleNode } = CollapsibleTitleNode;
const { $isCollapsibleContentNode } = CollapsibleContentNode;

function $createTitleBlock(level: ToggleLevel): ElementNode {
  return level === "paragraph"
    ? $createParagraphNode()
    : $createHeadingNode(level);
}

function $isTitleBlock(node: LexicalNode | null | undefined) {
  return $isParagraphNode(node) || $isHeadingNode(node);
}

/** A block, as against text and inline elements and decorators. */
function $isBlock(node: LexicalNode) {
  return (
    ($isElementNode(node) || $isDecoratorNode(node)) &&
    !node.isInline() &&
    !node.isParentRequired()
  );
}

/** The title's block: the paragraph or heading the title holds. */
export function $toggleTitleBlock(
  container: CollapsibleContainerNode,
): ElementNode | null {
  const title = container.getFirstChild();
  const block = $isCollapsibleTitleNode(title) ? title.getFirstChild() : null;
  return $isElementNode(block) ? block : null;
}

export function $toggleContent(
  container: CollapsibleContainerNode,
): CollapsibleContentNode | null {
  return container.getChildren().find($isCollapsibleContentNode) ?? null;
}

export function $toggleLevel(container: CollapsibleContainerNode): ToggleLevel {
  const block = $toggleTitleBlock(container);
  return $isHeadingNode(block) ? block.getTag() : "paragraph";
}

/** The toggle whose title holds `node`, if any. */
export function $toggleOfTitle(
  node: LexicalNode | null | undefined,
): CollapsibleContainerNode | null {
  for (let at = node; at; at = at.getParent()) {
    if ($isCollapsibleTitleNode(at)) {
      const container = at.getParent();
      return $isCollapsibleContainerNode(container) ? container : null;
    }
  }
  return null;
}

/** A closed, empty toggle whose title is a block of `level`. */
export function $createToggle(level: ToggleLevel = "paragraph", open = false) {
  const titleBlock = $createTitleBlock(level);
  const content = CollapsibleContentNode.$createCollapsibleContentNode().append(
    $createParagraphNode(),
  );
  const container = CollapsibleContainerNode.$createCollapsibleContainerNode(
    open,
  ).append(
    CollapsibleTitleNode.$createCollapsibleTitleNode().append(titleBlock),
    content,
  );
  return { container, titleBlock, content };
}

/** Makes the title's block one of `level`, keeping what it says. */
export function $setToggleLevel(
  container: CollapsibleContainerNode,
  level: ToggleLevel,
) {
  const block = $toggleTitleBlock(container);
  if (!block || $toggleLevel(container) === level) return;
  block.replace($createTitleBlock(level), true);
}

/**
 * Folds `blocks` into a new open toggle in their place: the first becomes
 * its title when it is a paragraph or heading, and the rest its content.
 */
export function $wrapInToggle(
  blocks: LexicalNode[],
  level: ToggleLevel = "paragraph",
): CollapsibleContainerNode | null {
  const [first, ...rest] = blocks;
  if (!first) return null;
  const { container, titleBlock, content } = $createToggle(level, true);
  first.insertBefore(container);
  if ($isTitleBlock(first) && $isElementNode(first)) {
    titleBlock.append(...first.getChildren());
    first.remove();
  } else {
    rest.unshift(first);
  }
  if (rest.length) {
    content.clear();
    content.append(...rest);
  }
  return container;
}

/**
 * Replaces a toggle with its title's block followed by what it held, and
 * returns that block.
 */
export function $unwrapToggle(
  container: CollapsibleContainerNode,
): ElementNode | null {
  const block = $toggleTitleBlock(container);
  const content = $toggleContent(container);
  for (const child of [
    ...(block ? [block] : []),
    ...(content?.getChildren() ?? []),
  ])
    container.insertBefore(child);
  container.remove();
  return block;
}

/** What `node` holds as text and inline nodes, its blocks flattened. */
function $inlineOf(node: ElementNode): LexicalNode[] {
  return node
    .getChildren()
    .flatMap((child) =>
      $isElementNode(child) && !child.isInline() ? $inlineOf(child) : [child],
    );
}

/**
 * A toggle reads as a title and content. Anything else in it, from a paste
 * or an old document, is put back into that shape: a missing part is made,
 * and what sits beside them goes into the content.
 */
export function $repairToggle(container: CollapsibleContainerNode) {
  let title = container.getChildren().find($isCollapsibleTitleNode);
  if (!title) {
    title = CollapsibleTitleNode.$createCollapsibleTitleNode();
    container.splice(0, 0, [title]);
  } else if (container.getFirstChild() !== title) {
    container.splice(0, 0, [title]);
  }
  const contents = container.getChildren().filter($isCollapsibleContentNode);
  const content =
    contents[0] ?? CollapsibleContentNode.$createCollapsibleContentNode();
  for (const child of container.getChildren()) {
    if (child === title || child === content) continue;
    if ($isCollapsibleContentNode(child)) {
      content.append(...child.getChildren());
      child.remove();
    } else content.append(child);
  }
  if (!content.getParent()) container.append(content);
}

/**
 * A title is one paragraph or heading. Inline content, as older documents
 * and imports hold it, is put in a paragraph; another kind of block becomes
 * a paragraph of what it says; and further blocks go to the top of the
 * content, opening the toggle so they stay in sight.
 */
export function $repairToggleTitle(title: CollapsibleTitleNode) {
  const container = title.getParent();
  if (!$isCollapsibleContainerNode(container)) {
    const children = title.getChildren();
    if (children.some($isBlock)) {
      for (const child of children) title.insertBefore(child);
      title.remove();
    } else title.replace($createParagraphNode().append(...children));
    return;
  }
  const children = title.getChildren();
  if (!children.some($isBlock)) {
    title.append($createParagraphNode().append(...children));
    return;
  }
  let run: ElementNode | null = null;
  for (const child of children) {
    if ($isBlock(child)) run = null;
    else {
      if (!run) {
        run = $createParagraphNode();
        child.insertBefore(run);
      }
      run.append(child);
    }
  }
  const [first, ...rest] = title.getChildren();
  if (first && !$isTitleBlock(first)) {
    if ($isElementNode(first))
      first.replace($createParagraphNode().append(...$inlineOf(first)));
    else {
      title.splice(0, 0, [$createParagraphNode()]);
      rest.unshift(first);
    }
  }
  if (!rest.length) return;
  const content = $toggleContent(container);
  if (!content) return;
  const top = content.getFirstChild();
  for (const block of rest) {
    if (top) top.insertBefore(block);
    else content.append(block);
  }
  container.setOpen(true);
}

/** Content outside a toggle is just its blocks; an empty one gets a line. */
export function $repairToggleContent(content: CollapsibleContentNode) {
  if (!$isCollapsibleContainerNode(content.getParent())) {
    for (const child of content.getChildren()) content.insertBefore(child);
    content.remove();
  } else if (content.isEmpty()) content.append($createParagraphNode());
}
