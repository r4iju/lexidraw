import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";
import { z } from "zod";

export type ICommunicationProps = {
  drawingId: string;
  userId: string;
};

export type ICommunicationOptions = {
  onMessage: (message: MessageStructure) => void;
}

export type MessageStructure = {
  type: "update";
  timestamp?: object | number | null;
  userId: string;
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};

export const MessageStructure = z.object({
  type: z.literal("update"),
  timestamp: z.object({}).optional().nullable(),
  userId: z.string(),
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

export type ICommunicationReturnType = {
  closeConnection: () => void;
  sendMessage: (message: MessageStructure) => void | Promise<void>;
  initializeConnection: () => void;
};

export type ICommunicationHook = (props: ICommunicationProps, options: ICommunicationProps) => ICommunicationReturnType;