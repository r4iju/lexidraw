import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { z } from "zod";

export * from "./enums.js";
export * from "./helpers.js";
export * from "./article.js";
export * from "./agent-tools-contract.js";
export * from "./tool-schemas.js";
export * from "./base-schemas.js";
export * from "./agent-events.js";

type DocumentPayload = {
  elements: string;
  appState?: null;
};

type DrawingPayload = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
};

const DocumentMessageStructure = z.object({
  type: z.literal("update"),
  entityType: z.literal("document"),
  timestamp: z.object({}).optional().nullable(),
  userId: z.string(),
  entityId: z.string(),
  payload: z.object({
    elements: z.string(),
  }),
});

type DocumentMessageStructure = {
  type: "update";
  entityType: "document";
  timestamp?: object | number | null;
  userId: string;
  entityId: string;
  payload: DocumentPayload;
};

const DrawingMessageStructure = z.object({
  type: z.literal("update"),
  entityType: z.literal("drawing"),
  timestamp: z.object({}).optional().nullable(),
  userId: z.string(),
  entityId: z.string(),
  payload: z.object({
    elements: z.array(
      z.object({
        type: z.string(),
        id: z.string(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        version: z.number(),
        isDeleted: z.boolean(),
        baseline: z.number().optional(),
      }),
    ),
    appState: z.object({}),
  }),
});

export type DrawingMessageStructure = {
  type: "update";
  entityType: "drawing";
  timestamp?: object | number | null;
  userId: string;
  entityId: string;
  payload: DrawingPayload;
};

export type MessageStructure =
  | DocumentMessageStructure
  | DrawingMessageStructure;

export const MessageStructure = z.union([
  DocumentMessageStructure,
  DrawingMessageStructure,
]);

export type WebRtcMessage =
  | {
      type: "join" | "leave";
      room: string;
      from: string; // userId
    }
  | {
      type: "offer";
      room: string;
      from: string; // userId
      to: string; // userId
      offer: string;
    }
  | {
      type: "answer";
      room: string;
      from: string; // userId
      to: string; // userId
      answer: string;
    }
  | {
      type: "iceCandidate";
      room: string;
      from: string; // userId
      to: string; // userId
      candidate: string;
    };
