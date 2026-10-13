const stop = (reason: string): never => {
  throw new Error(`Legacy document conversion STOP: ${reason}`);
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return stop("expected object");
  // Object and array checks above establish this property map.
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  if (
    Object.keys(v).length !== expected.length ||
    expected.some((k) => !Object.hasOwn(v, k))
  )
    stop("unknown or missing nested fields");
}
function nonempty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
export function assertSupportedDocumentRootV1(input: unknown) {
  const envelope = object(input);
  const node = (input: unknown, type: "root" | "paragraph" | "text") => {
    const n = object(input);
    keys(
      n,
      type === "text"
        ? ["detail", "format", "mode", "style", "text", "type", "version"]
        : ["children", "direction", "format", "indent", "type", "version"],
    );
    if (n.type !== type || n.version !== 1) stop("unsupported node or version");
    if (type === "text") {
      if (
        n.detail !== 0 ||
        n.format !== 0 ||
        n.mode !== "normal" ||
        n.style !== "" ||
        !nonempty(n.text)
      )
        stop("unsupported text fields");
    } else if (
      n.direction !== null ||
      n.format !== "" ||
      n.indent !== 0 ||
      !Array.isArray(n.children) ||
      !n.children.length
    )
      stop("unsupported or empty element");
    return n;
  };
  const root = node(envelope.root, "root");
  // Element branches have validated these children arrays.
  for (const p of root.children as unknown[]) {
    const paragraph = node(p, "paragraph");
    for (const text of paragraph.children as unknown[]) node(text, "text");
  }
}

export function assertSupportedLegacyAudioV1(input: unknown) {
  const audio = object(input);
  keys(audio, ["text", "audioUrl"]);
  if (!nonempty(audio.text) || !nonempty(audio.audioUrl))
    stop("unsupported audio metadata");
}
