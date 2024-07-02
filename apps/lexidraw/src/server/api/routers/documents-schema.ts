import { z } from "zod";

export const CreateDocument = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.any(),
});

export type CreateDocument = z.infer<typeof CreateDocument>
