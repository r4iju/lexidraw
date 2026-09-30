import "server-only";
import { blocksIn, savedBlock } from "./content";
import { captureBlock } from "./preview";
import type { BlockPreview } from "~/app/documents/[documentId]/nodes/HTMLBlockPreviews";
/** Called only after the enclosing document's render access was checked. */
export async function exportBlockPreviews(
  elements: string,
): Promise<Record<string, BlockPreview>> {
  const blocks = blocksIn(elements);
  const previews: Record<string, BlockPreview> = {};
  for (const block of blocks)
    previews[block.id] = {
      status: "failed",
      revision: block.revision,
      message: "Saved-state preview unavailable",
      width: 800,
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
          const data = await captureBlock(block, 800, signal);
          previews[block.id] = {
            status: "ready",
            revision: block.revision,
            data,
            width: 800,
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
