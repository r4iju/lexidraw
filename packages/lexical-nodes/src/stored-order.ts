import type { SerializedLexicalNode } from "lexical";

/**
 * Moves `keys` to the end of `json`, in the order given, and returns it.
 *
 * Documents are compared as strings when they're saved, so a node has to
 * write its keys in the order it always has. Lexical's walk writes a node's
 * own properties first and `type`, `version` and NodeState last, where the
 * nodes' hand-written `exportJSON` spread their parent's JSON and then added
 * their own: each node names the keys that come after that.
 */
export function inStoredOrder<T extends SerializedLexicalNode>(
  json: T,
  keys: readonly string[],
): T {
  for (const key of keys) {
    if (!Object.hasOwn(json, key)) continue;
    const value: unknown = Reflect.get(json, key);
    Reflect.deleteProperty(json, key);
    Reflect.set(json, key, value);
  }
  return json;
}

/**
 * `json` without its NodeState, for the nodes that never read any: what they
 * held is dropped when they're saved, as it always was.
 */
export function withoutNodeState<T extends { $?: unknown }>({
  $: _dropped,
  ...json
}: T): Omit<T, "$"> {
  return json;
}
