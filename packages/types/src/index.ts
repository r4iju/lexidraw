import { z } from "zod";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { UIAppState } from "@excalidraw/excalidraw/types/types";

export type MessageStructure = {
  type: "update";
  timestamp?: object | number | null;
  userId: string;
  drawingId: string;
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};

export const MessageStructure = z.object({
  type: z.literal("update"),
  timestamp: z.object({}).optional().nullable(),
  userId: z.string(),
  drawingId: z.string(),
  payload: z.object({
    elements: z.array(z.object({
      type: z.string(),
      id: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      version: z.number(),
      isDeleted: z.boolean(),
    })),
    appState: z.object({
    }),
  }),
});