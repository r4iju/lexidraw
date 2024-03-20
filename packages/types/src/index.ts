import { z } from "zod";
import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type AppState } from "@excalidraw/excalidraw/types/types";
export * from "./helpers";
export * from "./enums";

export type MessageStructure = {
  type: "update";
  timestamp?: object | number | null;
  userId: string;
  drawingId: string;
  payload: {
    elements: readonly ExcalidrawElement[];
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
    from: string; // userId
  }
  | {
    type: 'offer';
    room: string;
    from: string; // userId
    to: string; // userId
    offer: string;
  }
  | {
    type: 'answer';
    room: string;
    from: string; // userId
    to: string; // userId
    answer: string;
  }
  | {
    type: 'iceCandidate';
    room: string;
    from: string; // userId
    to: string; // userId
    candidate: string;
  };
