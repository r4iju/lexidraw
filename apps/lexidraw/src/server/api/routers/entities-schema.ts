import { z } from "zod";

export const CreateEntity = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.string(),
  entityType: z.enum(["drawing", "document", "directory", "url"]),
  parentId: z.string().nullable(),
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
});

export type SaveEntity = z.infer<typeof SaveEntity>;
