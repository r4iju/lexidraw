/**
 * `RangeSelection.deleteCharacter`, `deleteWord` and `deleteLine`, transcribed
 * from lexical@0.51.0 along with the private helpers they call.
 *
 * Lexical measures how far a deletion reaches by moving the browser's caret,
 * which a headless editor has no browser for, so it throws. Here `measure`
 * stands in for that one step with a model of where a caret lands, and
 * everything around it is Lexical's own code, so LexicalSwift is held to
 * Lexical on all but the measurement, and to this model on that. Removing a
 * segment of segmented text (mentions, #134) isn't transcribed, and throws.
 */
import {
  $caretFromPoint,
  $createNodeSelection,
  $createParagraphNode,
  $extendCaretToRange,
  $findMatchingParent,
  $getCaretRange,
  $getNearestRootOrShadowRoot,
  $getNodeByKey,
  $getRoot,
  $getSiblingCaret,
  $getSlotFrame,
  $getSlotHost,
  $getSlotNames,
  $hasAncestor,
  $isChildCaret,
  $isDecoratorNode,
  $isElementNode,
  $isExtendableTextPointCaret,
  $isLineBreakNode,
  $isRootNode,
  $isRootOrShadowRoot,
  $isSiblingCaret,
  $isTextNode,
  $needsBlockCursorBeside,
  $normalizeCaret,
  $normalizeSelection__EXPERIMENTAL as $normalizeSelection,
  $rewindSiblingCaret,
  $setPointFromCaret,
  $setSelection,
  $updateRangeSelectionFromCaretRange,
  type ChildCaret,
  type ElementNode,
  INTERNAL_$expandSelectionToWholeDocument,
  INTERNAL_$isBlock,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type RangeSelection,
  type TextNode,
} from "lexical";
import { EditorError } from "./editor-error.js";

export type Granularity = "character" | "word" | "lineboundary";

export function $deleteCharacter(
  selection: RangeSelection,
  isBackward: boolean,
): void {
  const wasCollapsed = selection.isCollapsed();
  if (selection.isCollapsed()) {
    const anchor = selection.anchor;
    let anchorNode: TextNode | ElementNode | null = anchor.getNode();
    if (selection.forwardDeletion(anchor, anchorNode, isBackward)) {
      const nextSibling = $isElementNode(anchorNode)
        ? anchorNode.getNextSibling()
        : null;
      if (
        !(
          $isElementNode(anchorNode) &&
          anchorNode.isEmpty() &&
          $isElementNode(nextSibling) &&
          nextSibling.isShadowRoot()
        )
      ) {
        return;
      }
    }
    const direction = isBackward ? "previous" : "next";
    const initialCaret = $caretFromPoint(anchor, direction);
    const initialRange = $extendCaretToRange(initialCaret);
    if (
      initialRange
        .getTextSlices()
        .every((slice) => slice === null || slice.distance === 0)
    ) {
      if (anchor.type === "element") {
        const adjacent = initialCaret.getNodeAtCaret();
        if ($isElementNode(adjacent) && $needsBlockCursorBeside(adjacent)) {
          const container = adjacent.getParent();
          adjacent.remove();
          const restored = $restoreEmptyContainerParagraph(container, adjacent);
          if (restored !== null) {
            restored.selectStart();
          }
          return;
        }
      }
      let state:
        | { type: "initial" }
        | { type: "merge-next-block"; block: ElementNode }
        | {
            type: "merge-block";
            caret: ChildCaret<ElementNode, typeof direction>;
            block: ElementNode;
          } = { type: "initial" };
      for (const caret of initialRange.iterNodeCarets("shadowRoot")) {
        if ($isChildCaret(caret)) {
          if (caret.origin.isInline()) {
            // fall through when descending an inline
          } else if (caret.origin.isShadowRoot()) {
            if (state.type === "merge-block") {
              break;
            }
            if (
              $isElementNode(initialRange.anchor.origin) &&
              initialRange.anchor.origin.isEmpty()
            ) {
              const normCaret = $normalizeCaret(caret);
              $updateRangeSelectionFromCaretRange(
                selection,
                $getCaretRange(normCaret, normCaret),
              );
              initialRange.anchor.origin.remove();
            }
            return;
          } else if (
            state.type === "merge-next-block" ||
            state.type === "merge-block"
          ) {
            state = { block: state.block, caret, type: "merge-block" };
          }
        } else if (state.type === "merge-block") {
          break;
        } else if ($isSiblingCaret(caret)) {
          if ($isElementNode(caret.origin)) {
            if (!caret.origin.isInline()) {
              state = { block: caret.origin, type: "merge-next-block" };
            } else if (!caret.origin.isParentOf(initialRange.anchor.origin)) {
              break;
            }
            continue;
          } else if ($isDecoratorNode(caret.origin)) {
            if (caret.origin.isIsolated()) {
              // do nothing, shouldn't delete an isolated decorator
            } else if (
              state.type === "merge-next-block" &&
              (caret.origin.isKeyboardSelectable() ||
                !caret.origin.isInline()) &&
              $isElementNode(initialRange.anchor.origin) &&
              initialRange.anchor.origin.isEmpty()
            ) {
              initialRange.anchor.origin.remove();
              const nodeSelection = $createNodeSelection();
              nodeSelection.add(caret.origin.getKey());
              $setSelection(nodeSelection);
            } else {
              const decorator = caret.origin;
              const container = decorator.getParent();
              decorator.remove();
              const restored = $restoreEmptyContainerParagraph(
                container,
                decorator,
              );
              if (restored !== null) {
                restored.selectStart();
              }
            }
            return;
          } else if ($isLineBreakNode(caret.origin)) {
            caret.origin.remove();
            return;
          }
          break;
        }
      }
      if (state.type === "merge-block") {
        const { caret, block } = state;
        if ($getSlotNames(block).length > 0) {
          return;
        }
        if (
          caret.origin.isEmpty() &&
          !block.isEmpty() &&
          caret.origin.getParent() === block.getParent()
        ) {
          caret.origin.remove(true);
          return;
        }
        $updateRangeSelectionFromCaretRange(
          selection,
          $getCaretRange(
            !caret.origin.isEmpty() && block.isEmpty()
              ? $rewindSiblingCaret($getSiblingCaret(block, caret.direction))
              : initialRange.anchor,
            caret,
          ),
        );
        selection.removeText();
        return;
      }
      for (let node: LexicalNode | null = anchor.getNode(); node !== null; ) {
        if ($getSlotHost(node) !== null) {
          return;
        }
        if ($isElementNode(node) && node.isShadowRoot()) {
          break;
        }
        node = node.getParent();
      }
    }

    const focus = selection.focus;
    $extendSelectionForDeletion(selection, isBackward, "character");

    if (!selection.isCollapsed()) {
      const focusNode = focus.type === "text" ? focus.getNode() : null;
      anchorNode = anchor.type === "text" ? anchor.getNode() : null;

      if (focusNode?.isSegmented()) {
        const offset = focus.offset;
        const textContentSize = focusNode.getTextContentSize();
        if (
          focusNode.is(anchorNode) ||
          (isBackward && offset !== textContentSize) ||
          (!isBackward && offset !== 0)
        ) {
          throw new EditorError(
            "unsupported",
            "Removing a segment isn't transcribed",
          );
        }
      } else if (anchorNode?.isSegmented()) {
        const offset = anchor.offset;
        const textContentSize = anchorNode.getTextContentSize();
        if (
          anchorNode.is(focusNode) ||
          (isBackward && offset !== 0) ||
          (!isBackward && offset !== textContentSize)
        ) {
          throw new EditorError(
            "unsupported",
            "Removing a segment isn't transcribed",
          );
        }
      }
      $updateCaretSelectionForUnicodeCharacter(selection, isBackward);
    } else if (isBackward && anchor.offset === 0) {
      if ($collapseAtStart(selection, anchor.getNode())) {
        return;
      }
    }
  }
  if (!wasCollapsed) {
    INTERNAL_$expandSelectionToWholeDocument(selection);
  }
  selection.removeText();
  if (
    isBackward &&
    !wasCollapsed &&
    selection.isCollapsed() &&
    selection.anchor.type === "element" &&
    selection.anchor.offset === 0
  ) {
    const anchorNode = selection.anchor.getNode();
    if (
      anchorNode.isEmpty() &&
      $isRootNode(anchorNode.getParent()) &&
      anchorNode.getPreviousSibling() === null
    ) {
      $collapseAtStart(selection, anchorNode);
    }
    $ensureRootHasParagraph();
  }
}

export function $deleteLine(
  selection: RangeSelection,
  isBackward: boolean,
): void {
  const wasCollapsed = selection.isCollapsed();
  const anchorNode = $getNodeByKey(selection.anchor.key);
  const anchorSlotFrame =
    anchorNode === null ? null : $getSlotFrame(anchorNode);
  if (
    anchorSlotFrame !== null &&
    $isDecoratorNode($getSlotHost(anchorSlotFrame))
  ) {
    if (!selection.isCollapsed()) {
      selection.focus.set(
        selection.anchor.key,
        selection.anchor.offset,
        selection.anchor.type,
      );
    }
    $deleteCharacter(selection, isBackward);
    return;
  }
  if (selection.isCollapsed()) {
    $extendSelectionForDeletion(selection, isBackward, "lineboundary");
  }
  if (selection.isCollapsed()) {
    $deleteCharacter(selection, isBackward);
  } else {
    const anchorBlock = $findMatchingParent(
      selection.anchor.getNode(),
      INTERNAL_$isBlock,
    );
    const focusBlock = $findMatchingParent(
      selection.focus.getNode(),
      INTERNAL_$isBlock,
    );
    if (anchorBlock !== focusBlock) {
      selection.focus.set(
        selection.anchor.key,
        selection.anchor.offset,
        selection.anchor.type,
      );
      $deleteCharacter(selection, isBackward);
    } else {
      if (!wasCollapsed) {
        INTERNAL_$expandSelectionToWholeDocument(selection);
      }
      selection.removeText();
    }
  }
}

export function $deleteWord(
  selection: RangeSelection,
  isBackward: boolean,
): void {
  const wasCollapsed = selection.isCollapsed();
  if (selection.isCollapsed()) {
    const anchor = selection.anchor;
    const anchorNode: TextNode | ElementNode | null = anchor.getNode();
    if (selection.forwardDeletion(anchor, anchorNode, isBackward)) {
      return;
    }
    $extendSelectionForDeletion(selection, isBackward, "word");
  }
  if (selection.isCollapsed()) {
    $deleteCharacter(selection, isBackward);
  } else {
    if (!wasCollapsed) {
      INTERNAL_$expandSelectionToWholeDocument(selection);
    }
    selection.removeText();
  }
}

function $ensureRootHasParagraph(): void {
  const root = $getRoot();
  if (root.isEmpty()) {
    const paragraph = $createParagraphNode();
    root.append(paragraph);
    paragraph.select();
  }
}

function $restoreEmptyContainerParagraph(
  container: null | LexicalNode,
  removedChild: null | LexicalNode,
) {
  if (
    !$isRootOrShadowRoot(container) ||
    !container.isAttached() ||
    !container.isEmpty() ||
    !(
      $isRootNode(container) ||
      (removedChild !== null && INTERNAL_$isBlock(removedChild))
    )
  ) {
    return null;
  }
  const paragraph = $createParagraphNode();
  container.append(paragraph);
  return paragraph;
}

function $collapseAtStart(
  selection: RangeSelection,
  startNode: LexicalNode,
): boolean {
  for (
    let node: null | LexicalNode = startNode;
    node;
    node = node.getParent()
  ) {
    if ($isElementNode(node)) {
      if (node.collapseAtStart(selection)) {
        return true;
      }
      if ($isRootOrShadowRoot(node)) {
        break;
      }
    }
    if (node.getPreviousSibling()) {
      break;
    }
  }
  return false;
}

function $updateCaretSelectionForUnicodeCharacter(
  selection: RangeSelection,
  isBackward: boolean,
): void {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (
    anchorNode === focusNode &&
    anchor.type === "text" &&
    focus.type === "text"
  ) {
    const anchorOffset = anchor.offset;
    const focusOffset = focus.offset;
    const isBefore = anchorOffset < focusOffset;
    const startOffset = isBefore ? anchorOffset : focusOffset;
    const endOffset = isBefore ? focusOffset : anchorOffset;
    const characterOffset = endOffset - 1;
    if (startOffset !== characterOffset) {
      const text = anchorNode.getTextContent().slice(startOffset, endOffset);
      if (shouldDeleteExactlyOneCodeUnit(text)) {
        if (isBackward) {
          focus.set(focus.key, characterOffset, focus.type);
        } else {
          anchor.set(anchor.key, characterOffset, anchor.type);
        }
      }
    }
  }
}

function shouldDeleteExactlyOneCodeUnit(text: string): boolean {
  return !(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]/g.test(text) || /\p{Emoji}/u.test(text)
  );
}

function $extendSelectionForDeletion(
  selection: RangeSelection,
  isBackward: boolean,
  granularity: Granularity,
): void {
  if (
    $modifySelectionAroundDecoratorsAndBlocks(
      selection,
      "extend",
      isBackward,
      granularity,
    )
  ) {
    return;
  }
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  const anchorOffset = anchor.offset;
  const wasCollapsed = selection.isCollapsed();
  const focus = selection.focus;
  const landed = measure(focus, isBackward, granularity);
  if (landed === null) {
    return;
  }
  if (
    wasCollapsed &&
    granularity === "character" &&
    anchor.type === "text" &&
    $isTextNode(anchorNode) &&
    anchorNode.isUnmergeable()
  ) {
    const boundaryOffset = isBackward ? 0 : anchorNode.getTextContentSize();
    if (anchorOffset === boundaryOffset) {
      const sibling = $getSiblingCaret(
        anchorNode,
        isBackward ? "previous" : "next",
      ).getNodeAtCaret();
      if ($isTextNode(sibling)) {
        const sibOffset = isBackward ? sibling.getTextContentSize() - 1 : 1;
        selection.focus.set(sibling.__key, sibOffset, "text");
        selection.dirty = true;
        return;
      }
    }
  }
  if (wasCollapsed && granularity === "character" && anchor.type === "text") {
    const edgeOffset = isBackward ? 0 : anchorNode.getTextContentSize();
    const clampedOffset =
      landed.key === anchor.key && landed.type === "text"
        ? landed.offset
        : anchorOffset !== edgeOffset
          ? edgeOffset
          : -1;
    if (clampedOffset >= 0) {
      if (clampedOffset !== anchorOffset) {
        selection.focus.set(anchor.key, clampedOffset, "text");
        selection.dirty = true;
      }
      return;
    }
  }
  const origin: Position = {
    key: anchor.key,
    offset: anchorOffset,
    type: anchor.type,
  };
  const [start, end] = isBackward ? [landed, origin] : [origin, landed];
  const root = $isRootNode(anchorNode)
    ? anchorNode
    : $getNearestRootOrShadowRoot(anchorNode);
  $applyRange(selection, start, end);
  selection.dirty = true;
  if (!$shrinkSelectionToRoot(selection, isBackward, root) && isBackward) {
    $swapPoints(selection);
  }
  if (granularity === "lineboundary") {
    $modifySelectionAroundDecoratorsAndBlocks(
      selection,
      "extend",
      isBackward,
      granularity,
      "decorators",
    );
  }
}

/** A place a caret can be, as the point a browser's would resolve to. */
type Position = { key: NodeKey; offset: number; type: "text" | "element" };

/**
 * Where a caret at `point` lands when moved one `granularity` towards
 * `isBackward`. The model reads the line of text the point is in, its
 * element's text with a line break reading as "\n": a character is a
 * grapheme; a word is a run of graphemes starting with a letter, digit or
 * underscore, reached past whatever else lies before it; and a line ends at a
 * line break or at the element's edge. It stays in the element, as the step
 * into a neighbouring block is Lexical's own, taken before measuring. Null,
 * like a browser with no selection, is an element holding anything but text
 * and line breaks, which the model doesn't lay out.
 */
function measure(
  point: PointType,
  isBackward: boolean,
  granularity: Granularity,
): Position | null {
  const pointNode = point.getNode();
  const element = point.type === "text" ? pointNode.getParent() : pointNode;
  if (!$isElementNode(element)) {
    return null;
  }
  const children = element.getChildren();
  if (
    !children.every((child) => $isTextNode(child) || $isLineBreakNode(child))
  ) {
    return null;
  }
  const starts: number[] = [];
  let text = "";
  for (const child of children) {
    starts.push(text.length);
    text += child.getTextContent();
  }
  const index = point.type === "text" ? pointNode.getIndexWithinParent() : -1;
  const from =
    point.type === "text"
      ? (starts[index] ?? 0) + point.offset
      : (starts[point.offset] ?? text.length);
  const to = landing(text, from, isBackward, granularity);
  if (to === from) {
    return { key: point.key, offset: point.offset, type: point.type };
  }
  // The unit the caret crossed last decides which node it lands in.
  const crossed = isBackward ? to : to - 1;
  let at = 0;
  while (at + 1 < starts.length && (starts[at + 1] ?? 0) <= crossed) at++;
  const child = children[at];
  if ($isTextNode(child)) {
    return {
      key: child.getKey(),
      offset: to - (starts[at] ?? 0),
      type: "text",
    };
  }
  const beside = children[isBackward ? at - 1 : at + 1];
  if ($isTextNode(beside)) {
    return {
      key: beside.getKey(),
      offset: isBackward ? beside.getTextContentSize() : 0,
      type: "text",
    };
  }
  return {
    key: element.getKey(),
    offset: isBackward ? at : at + 1,
    type: "element",
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function landing(
  text: string,
  from: number,
  isBackward: boolean,
  granularity: Granularity,
): number {
  if (granularity === "lineboundary") {
    return isBackward
      ? from === 0
        ? 0
        : text.lastIndexOf("\n", from - 1) + 1
      : text.indexOf("\n", from) === -1
        ? text.length
        : text.indexOf("\n", from);
  }
  const units = [...graphemes.segment(text)].map(({ index, segment }) => ({
    start: index,
    end: index + segment.length,
    word: /^[\p{L}\p{N}_]/u.test(segment),
  }));
  const ahead = isBackward
    ? units.filter((unit) => unit.start < from).reverse()
    : units.filter((unit) => unit.end > from);
  if (granularity === "character") {
    const unit = ahead[0];
    return unit === undefined ? from : isBackward ? unit.start : unit.end;
  }
  let crossed = 0;
  while (crossed < ahead.length && !ahead[crossed]?.word) crossed++;
  while (crossed < ahead.length && ahead[crossed]?.word) crossed++;
  const last = ahead[crossed - 1];
  return last === undefined ? from : isBackward ? last.start : last.end;
}

/**
 * `RangeSelection.applyDOMRange` for positions `measure` gives, which are
 * already the points a DOM position resolves to.
 */
function $applyRange(
  selection: RangeSelection,
  start: Position,
  end: Position,
): void {
  const anchor = selection.clone().anchor;
  const focus = selection.clone().focus;
  anchor.set(start.key, start.offset, start.type);
  focus.set(end.key, end.offset, end.type);
  $normalizeSelectionPointsForBoundaries(anchor, focus);
  selection.anchor.set(anchor.key, anchor.offset, anchor.type, true);
  selection.focus.set(focus.key, focus.offset, focus.type, true);
  $normalizeSelection(selection);
}

function $shrinkSelectionToRoot(
  selection: RangeSelection,
  isBackward: boolean,
  root: LexicalNode,
): boolean {
  const nodes = selection.getNodes();
  const validNodes = nodes.filter((node) => $hasAncestor(node, root));
  if (validNodes.length === 0 || validNodes.length === nodes.length) {
    return false;
  }
  const edgeNode = isBackward
    ? validNodes[0]
    : validNodes[validNodes.length - 1];
  if (edgeNode === undefined) {
    return false;
  }
  const edgeElement = $isElementNode(edgeNode)
    ? edgeNode
    : edgeNode.getParentOrThrow();
  if (isBackward) {
    edgeElement.selectStart();
  } else {
    edgeElement.selectEnd();
  }
  return true;
}

function $swapPoints(selection: RangeSelection): void {
  const focus = selection.focus;
  const anchor = selection.anchor;
  const anchorKey = anchor.key;
  const anchorOffset = anchor.offset;
  const anchorType = anchor.type;
  anchor.set(focus.key, focus.offset, focus.type, true);
  focus.set(anchorKey, anchorOffset, anchorType, true);
}

export function $normalizeSelectionPointsForBoundaries(
  anchor: PointType,
  focus: PointType,
): void {
  if (anchor.type === "text" && focus.type === "text") {
    const isBackward = anchor.isBefore(focus);
    const isCollapsed = anchor.is(focus);
    resolveSelectionPointOnBoundary(anchor, isBackward, isCollapsed);
    resolveSelectionPointOnBoundary(focus, !isBackward, isCollapsed);
    if (isCollapsed) {
      focus.set(anchor.key, anchor.offset, anchor.type);
    }
  }
}

function resolveSelectionPointOnBoundary(
  point: PointType,
  isBackward: boolean,
  isCollapsed: boolean,
): void {
  const offset = point.offset;
  const node = point.getNode();
  if (offset === 0) {
    const prevSibling = node.getPreviousSibling();
    const parent = node.getParent();
    if (!isBackward) {
      if (
        $isElementNode(prevSibling) &&
        !isCollapsed &&
        prevSibling.isInline()
      ) {
        point.set(prevSibling.__key, prevSibling.getChildrenSize(), "element");
      } else if (
        $isTextNode(prevSibling) &&
        !($isTextNode(node) && node.isUnmergeable())
      ) {
        point.set(
          prevSibling.__key,
          prevSibling.getTextContent().length,
          "text",
        );
      }
    } else if (
      (isCollapsed || !isBackward) &&
      prevSibling === null &&
      $isElementNode(parent) &&
      parent.isInline()
    ) {
      const parentSibling = parent.getPreviousSibling();
      if ($isTextNode(parentSibling)) {
        point.set(
          parentSibling.__key,
          parentSibling.getTextContent().length,
          "text",
        );
      }
    }
  } else if (offset === node.getTextContent().length) {
    const nextSibling = node.getNextSibling();
    const parent = node.getParent();
    if (isBackward && $isElementNode(nextSibling) && nextSibling.isInline()) {
      point.set(nextSibling.__key, 0, "element");
    } else if (
      (isCollapsed || isBackward) &&
      nextSibling === null &&
      $isElementNode(parent) &&
      parent.isInline() &&
      !parent.canInsertTextAfter() &&
      parent.getTextContentSize() > 1
    ) {
      const parentSibling = parent.getNextSibling();
      if ($isTextNode(parentSibling)) {
        point.set(parentSibling.__key, 0, "text");
      }
    }
  }
}

function $modifySelectionAroundDecoratorsAndBlocks(
  selection: RangeSelection,
  alter: "move" | "extend",
  isBackward: boolean,
  granularity: Granularity,
  mode: "decorators-and-blocks" | "decorators" = "decorators-and-blocks",
): boolean {
  if (
    alter === "move" &&
    granularity === "character" &&
    !selection.isCollapsed()
  ) {
    const [src, dst] =
      isBackward === selection.isBackward()
        ? [selection.focus, selection.anchor]
        : [selection.anchor, selection.focus];
    dst.set(src.key, src.offset, src.type);
    return true;
  }
  const initialFocus = $caretFromPoint(
    selection.focus,
    isBackward ? "previous" : "next",
  );
  const isLineBoundary = granularity === "lineboundary";
  const collapse = alter === "move";
  let focus = initialFocus;
  let checkForBlock = mode === "decorators-and-blocks";
  let isolated = false;
  if (!$isExtendableTextPointCaret(focus)) {
    for (const siblingCaret of focus) {
      checkForBlock = false;
      const { origin } = siblingCaret;
      if ($isDecoratorNode(origin)) {
        if (origin.isIsolated()) {
          isolated = true;
          break;
        }
        focus = siblingCaret;
        if (isLineBoundary && origin.isInline()) {
          continue;
        }
      }
      break;
    }
    if (isolated) {
      return true;
    }
    if (checkForBlock) {
      for (const nextCaret of $extendCaretToRange(initialFocus).iterNodeCarets(
        alter === "extend" ? "shadowRoot" : "root",
      )) {
        if ($isChildCaret(nextCaret)) {
          if (!nextCaret.origin.isInline()) {
            focus = nextCaret;
          }
        } else if ($isElementNode(nextCaret.origin)) {
          continue;
        } else if (
          $isDecoratorNode(nextCaret.origin) &&
          !nextCaret.origin.isInline()
        ) {
          focus = nextCaret;
        }
        break;
      }
    }
  }
  if (focus === initialFocus) {
    return false;
  }
  if (
    collapse &&
    !isLineBoundary &&
    $isDecoratorNode(focus.origin) &&
    focus.origin.isKeyboardSelectable()
  ) {
    const nodeSelection = $createNodeSelection();
    nodeSelection.add(focus.origin.getKey());
    $setSelection(nodeSelection);
    return true;
  }
  focus = $normalizeCaret(focus);
  if (collapse) {
    $setPointFromCaret(selection.anchor, focus);
  }
  $setPointFromCaret(selection.focus, focus);
  return checkForBlock || !isLineBoundary;
}
