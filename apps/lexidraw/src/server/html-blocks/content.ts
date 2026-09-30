import { createHash, randomUUID } from "node:crypto";
import {
  parseHTMLBlockSource,
  type SavedHTMLBlock,
} from "@packages/lexical-nodes/html-block";
import type { DocumentRevision, DocumentStore } from "../documents/write";
import { StaleDocumentError } from "../documents/conflict";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function savedBlock(
  source: unknown,
  id: string = randomUUID(),
): SavedHTMLBlock {
  const parsed = parseHTMLBlockSource(source);
  const { id: _id, revision: _revision, ...content } = parsed;
  return {
    ...content,
    id,
    revision: createHash("sha256").update(canonical(content)).digest("hex"),
  } as SavedHTMLBlock;
}

type StoredNode = {
  type?: string;
  block?: SavedHTMLBlock;
  children?: StoredNode[];
  [key: string]: unknown;
};
function stateOf(elements: string): { root: StoredNode } {
  const state = JSON.parse(elements);
  if (!state?.root || !Array.isArray(state.root.children))
    throw new Error("Invalid document content");
  return state;
}
export function blocksIn(elements: string): SavedHTMLBlock[] {
  const blocks: SavedHTMLBlock[] = [];
  const visit = (node: StoredNode) => {
    if (node.type === "html-block" && node.block) blocks.push(node.block);
    node.children?.forEach(visit);
  };
  visit(stateOf(elements).root);
  return blocks;
}
export type BlockChange =
  | { kind: "create"; source: unknown; atBlockIndex: number }
  | { kind: "update"; blockId: string; source: unknown }
  | { kind: "delete"; blockId: string };
export async function changeBlock(
  store: DocumentStore,
  entity: DocumentRevision,
  change: BlockChange,
  expected: string,
) {
  if (entity.updatedAt.toISOString() !== expected)
    throw new StaleDocumentError(entity.updatedAt, "Document");
  const state = stateOf(entity.elements);
  let block: SavedHTMLBlock | undefined;
  if (change.kind === "create") {
    const children = state.root.children;
    if (
      !children ||
      change.atBlockIndex < 0 ||
      change.atBlockIndex > children.length
    )
      throw new Error("Block index outside document");
    block = savedBlock(change.source);
    children.splice(change.atBlockIndex, 0, {
      type: "html-block",
      version: 1,
      block,
    });
  } else {
    let found = false;
    const visit = (parent: StoredNode) => {
      const children = parent.children ?? [];
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node?.type === "html-block" && node.block?.id === change.blockId) {
          if (found) throw new Error("Duplicate HTML block identity");
          found = true;
          if (change.kind === "delete") {
            children.splice(i--, 1);
          } else {
            block = savedBlock(
              { ...node.block, ...parseHTMLBlockSource(change.source) },
              change.blockId,
            );
            node.block = block;
          }
        } else if (node) visit(node);
      }
    };
    visit(state.root);
    if (!found) throw new Error("HTML block not found");
  }
  if (state.root.children?.length === 0)
    state.root.children.push({
      type: "paragraph",
      version: 1,
      children: [],
      direction: null,
      format: "",
      indent: 0,
      textFormat: 0,
      textStyle: "",
    });
  const written = await store.write(
    entity.id,
    { elements: JSON.stringify(state) },
    entity.updatedAt,
  );
  if (!written) {
    const current = await store.read(entity.id);
    if (current) throw new StaleDocumentError(current.updatedAt, "Document");
    throw new Error("Document not found");
  }
  return { ...written, block };
}
