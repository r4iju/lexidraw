import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";
import { MessageStructure } from "@packages/types";
import { z } from "zod";

export type ICommunicationProps = {
  drawingId: string;
  userId: string;
};

export type ICommunicationOptions = {
  onMessage: (message: MessageStructure) => void;
  onConnectionClose: () => void;
  onConnectionOpen: () => void;
}

export type ICommunicationReturnType = {
  closeConnection: () => void;
  sendMessage: (message: MessageStructure) => void | Promise<void>;
  initializeConnection: () => void;
};

export type ICommunicationHook = (props: ICommunicationProps, options: ICommunicationProps) => ICommunicationReturnType;