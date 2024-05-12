import { type MessageStructure } from "@packages/types";

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
  peers: string[]; // userIds
  closeConnection: (muted?: boolean) => void;
  sendMessage: (message: MessageStructure) => void | Promise<void>;
  initializeConnection: () => Promise<void>;
};

export type ICommunicationHook = (props: ICommunicationProps, options: ICommunicationProps) => ICommunicationReturnType;