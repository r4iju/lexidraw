import { z } from "zod";
import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type AppState } from "@excalidraw/excalidraw/types/types";
export * from "./helpers";

export type MessageStructure = {
  type: "update";
  timestamp?: object | number | null;
  userId: string;
  drawingId: string;
  payload: {
    elements: ExcalidrawElement[];
    appState: AppState;
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

export type WebRtcMessage =
  | {
    type: 'join' | 'leave';
    room: string;
    userId: string;
  }
  | {
    room: string;
    userId: string;
    type: 'offer';
    offer: string;
  }
  | {
    room: string;
    userId: string;
    type: 'answer';
    answer: string;
  }
  | {
    room: string;
    userId: string;
    type: 'iceCandidate';
    candidate: string;
  };
