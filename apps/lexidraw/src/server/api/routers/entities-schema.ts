import { z } from "zod";

export const CreateEntity = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.string(),
  entityType: z.enum(["drawing", "document", "directory"]),
  parentId: z.string().nullable(),
});

export type CreateEntity = z.infer<typeof CreateEntity>

export const SaveEntity = z.object({
  id: z.string(),
  title: z.string().optional(),
  elements: z.string(),
  appState: z.string().optional(),
  entityType: z.enum(["drawing", "document", "directory"]),
  parentId: z.string().nullable(),
})

export type SaveEntity = z.infer<typeof SaveEntity>
