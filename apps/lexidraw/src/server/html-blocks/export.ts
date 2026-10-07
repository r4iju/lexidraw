import "server-only";
import { blocksIn, savedBlock } from "./content";
import { captureBlock } from "./preview";
import type { BlockPreview } from "~/app/documents/[documentId]/nodes/HTMLBlockPreviews";
/** Exports are printed or shared as images, so blocks are captured as on light paper. */
const PAPER = { width: 800, theme: "light" } as const;
/** Called only after the enclosing document's render access was checked. */
export async function exportBlockPreviews(
  elements: string,
): Promise<Record<string, BlockPreview>> {
  const blocks = blocksIn(elements);
  const previews: Record<string, BlockPreview> = {};
  for (const block of blocks)
    previews[block.id] = {
      status: "failed",
      reason: "unavailable",
      revision: block.revision,
      message: "Saved-state preview unavailable",
      width: PAPER.width,
      height: block.height,
    };
  const signal = AbortSignal.timeout(20000);
  let index = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (index < Math.min(blocks.length, 16)) {
        const block = blocks[index++];
        if (!block) continue;
        try {
          if (savedBlock(block, block.id).revision !== block.revision) continue;
          const capture = await captureBlock(block, PAPER, { signal });
          previews[block.id] = {
            ...capture,
            revision: block.revision,
            width: PAPER.width,
            height: block.height,
          };
        } catch {
          /* The explicit fallback above remains in the exported document. */
        }
      }
    }),
  );
  return previews;
}
