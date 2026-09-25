import { type NaturalSize, parseNaturalSize } from "@packages/lexical-nodes";
import { probeImageSize } from "./image-probe";

type Node = {
  type?: unknown;
  src?: unknown;
  $?: { natural?: { width?: unknown; height?: unknown } };
  children?: unknown;
};

type Options = {
  probe?: (src: string) => Promise<NaturalSize | undefined>;
  /** How many addresses one write measures; the rest wait for a reader. */
  limit?: number;
  failures?: Map<string, number>;
  /** How many failed addresses are kept; the oldest go first. */
  remember?: number;
  now?: () => number;
};

const RETRY_AFTER = 10 * 60 * 1000;
const LONGEST_URL = 2048;
const recentFailures = new Map<string, number>();

/**
 * `elements` with every picture from outside the app that has no natural
 * size given the one its first bytes say, so that the first reader of a
 * document written by an agent or the CLI sees it keep its place. A picture
 * that cannot be measured quickly stays unmeasured, and the first reader's
 * browser measures it; an address that failed is not asked again for ten
 * minutes. Returns `elements` unchanged when there is nothing to store.
 */
export async function measureImages(
  elements: string,
  {
    probe = probeImageSize,
    limit = 8,
    failures = recentFailures,
    remember = 1000,
    now = Date.now,
  }: Options = {},
): Promise<string> {
  let document: { root?: Node };
  try {
    document = JSON.parse(elements);
  } catch {
    return elements;
  }
  if (!document?.root || typeof document.root !== "object") return elements;

  const unmeasured = new Map<string, Node[]>();
  const visit = (node: Node) => {
    if (
      node.type === "image" &&
      typeof node.src === "string" &&
      node.src.length <= LONGEST_URL &&
      /^https?:\/\//i.test(node.src) &&
      !parseNaturalSize(node.$?.natural)
    )
      unmeasured.set(node.src, [...(unmeasured.get(node.src) ?? []), node]);
    if (Array.isArray(node.children))
      for (const child of node.children)
        if (child && typeof child === "object") visit(child as Node);
  };
  visit(document.root);

  for (const [src, until] of failures) if (until <= now()) failures.delete(src);
  const sources = [...unmeasured.keys()]
    .filter((src) => !failures.has(src))
    .slice(0, limit);
  if (sources.length === 0) return elements;

  const sizes = await Promise.all(sources.map((src) => probe(src)));
  let stored = false;
  sources.forEach((src, index) => {
    const size = sizes[index];
    if (!size) {
      failures.delete(src);
      failures.set(src, now() + RETRY_AFTER);
      for (const oldest of failures.keys()) {
        if (failures.size <= remember) break;
        failures.delete(oldest);
      }
      return;
    }
    for (const node of unmeasured.get(src) ?? []) {
      node.$ = { ...node.$, natural: size };
      stored = true;
    }
  });
  return stored ? JSON.stringify(document) : elements;
}
