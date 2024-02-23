import { type ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";

export interface ICommunicationService {
  initialize(): void;
  sendMessage(message: MessageStructure): void;
  onMessage(callback: (message: MessageStructure) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
  close(): void;
}

export type MessageStructure = {
  type: "update";
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};