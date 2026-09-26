import { z } from "zod";

export const CreateEntity = z.object({
  id: z.string(),
  title: z.string(),
  elements: z
    .string()
    .optional()
    .describe(
      "Omitted starts the entity empty, as the editor opens a new one. A url needs it: its address is its content.",
    ),
  entityType: z.enum(["drawing", "document", "directory", "url"]),
  parentId: z
    .string()
    .nullish()
    .describe("The folder it goes into; omitted or null is Home"),
});

export type CreateEntity = z.infer<typeof CreateEntity>;

export const SaveEntity = z.object({
  id: z.string(),
  title: z.string().optional(),
  elements: z.string(),
  // Omitted leaves the stored appState alone; null clears it.
  appState: z.string().nullable().optional(),
  // Carried by the editors but not written back: a save never retypes an
  // entity, so a REST caller does not have to look it up to send one.
  entityType: z.enum(["drawing", "document", "directory", "url"]).optional(),
  parentId: z.string().optional(),
  /**
   * The `updatedAt` of the revision this content was made over. A save that
   * no longer matches it is refused with CONFLICT instead of overwriting what
   * was written since.
   */
  ifUnmodifiedSince: z.iso.datetime().optional(),
});

export type SaveEntity = z.infer<typeof SaveEntity>;
