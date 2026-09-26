/**
 * A refusal, of a kind `EditorError` in `EditorModel.swift` names. Anything
 * else thrown, as by Lexical's own invariants, is `invalidState`.
 */
export class EditorError extends Error {
  constructor(
    readonly kind: "noNode" | "noSelection" | "unsupported" | "invalidState",
    message: string,
    readonly path?: number[],
  ) {
    super(message);
  }
}
