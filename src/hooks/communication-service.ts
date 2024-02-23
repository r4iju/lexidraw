import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";

export type ICommunicationProps = {
  drawingId: string;
  userId: string;
};

export type ICommunicationOptions = {
  onMessage: (message: MessageStructure) => void;
}

export type MessageStructure = {
  type: "update";
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};

export type ICommunicationReturnType = {
  closeConnection: () => void;
  sendMessage: (message: MessageStructure) => void;
  initializeConnection: () => void;
};

export type ICommunicationHook = (props: ICommunicationProps, options: ICommunicationProps) => ICommunicationReturnType;