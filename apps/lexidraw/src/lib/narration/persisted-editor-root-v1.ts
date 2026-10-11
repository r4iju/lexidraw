import { z } from "zod";

const text = z
  .object({
    detail: z.literal(0),
    format: z.literal(0),
    mode: z.literal("normal"),
    style: z.literal(""),
    text: z.string().min(1),
    type: z.literal("text"),
    version: z.literal(1),
  })
  .strict();
const element = {
  direction: z.null(),
  format: z.literal(""),
  indent: z.literal(0),
  version: z.literal(1),
};
const paragraph = z
  .object({
    ...element,
    children: z.array(text).min(1),
    type: z.literal("paragraph"),
    textFormat: z.literal(0).optional(),
    textStyle: z.literal("").optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.textFormat === undefined) === (value.textStyle === undefined),
  );

/** Playback v1 admits original paragraphs or the serializer's paired defaults.
 * Other format state and node families require an explicit future contract.
 * Unknown envelope metadata is retained; nested editor fields are exact.
 */
const persistedEditorEnvelopeV1 = z
  .object({
    root: z
      .object({
        ...element,
        children: z.array(paragraph).min(1),
        type: z.literal("root"),
      })
      .strict(),
  })
  .passthrough();

export function assertSupportedPersistedEditorRootV1(input: unknown): void {
  persistedEditorEnvelopeV1.parse(input);
}
