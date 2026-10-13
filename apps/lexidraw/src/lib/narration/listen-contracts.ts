import { z } from "zod";
// Legacy manifests are read-only. Validate playable media at their untrusted boundary.
export const ListenSegment = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  audioUrl: z.string().min(1),
  sectionTitle: z.string().optional(),
  sectionId: z.string().optional(),
  sectionIndex: z.number().int().nonnegative().optional(),
});
export type ListenSegment = z.infer<typeof ListenSegment>;
export const ListenSegments = z.array(ListenSegment);
