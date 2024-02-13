import { type Prisma } from "@prisma/client";
import { z } from "zod";

type Element = Prisma.ElementCreateInput;
type AppState = Prisma.AppStateCreateInput;

export const CreateDrawing = z.object({
  id: z.string(),
  title: z.string(),
});

export type CreateDrawing = z.infer<typeof CreateDrawing>

export const Element = z.object({
  id: z.string(),
  type: z.enum(["text", "selection", "rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "image", "frame", "embeddable"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  properties: z.string(),
})

export const AppState = z.object({

})

export const SaveDrawing = z.object({
  id: z.string(),
  title: z.string().optional(),
  elements: z.array(Element),
  appState: z.string(),
})

export type SaveDrawing = z.infer<typeof SaveDrawing>