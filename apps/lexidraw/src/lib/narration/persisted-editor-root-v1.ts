import { z } from "zod";

// Saved audio belongs to the envelope, independent of its editor nodes.
// Keep the converted root's version and shape gate without interpreting its children.
const persistedEditorEnvelopeV1 = z
  .object({
    root: z
      .object({
        children: z.array(z.unknown()),
        direction: z.enum(["ltr", "rtl"]).nullable(),
        format: z.string(),
        indent: z.number().int().nonnegative(),
        type: z.literal("root"),
        version: z.literal(1),
      })
      .strict(),
  })
  .passthrough();
const versionedNode = z
  .object({
    children: z.array(z.unknown()).optional(),
    type: z.string().min(1),
    version: z.literal(1),
  })
  .passthrough();

function assertVersionedChildren(children: unknown[]): void {
  for (const child of children) {
    const node = versionedNode.parse(child);
    if (node.children) assertVersionedChildren(node.children);
  }
}

export function assertSupportedPersistedEditorRootV1(input: unknown): void {
  const envelope = persistedEditorEnvelopeV1.parse(input);
  assertVersionedChildren(envelope.root.children);
}
