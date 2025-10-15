import { useCallback, useEffect, useState } from "react";
import firestore from "~/server/firestore";
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import type {
  ICommunicationOptions,
  ICommunicationProps,
  ICommunicationReturnType,
} from "./interface";
import { toast } from "sonner";
import type { MessageStructure } from "@packages/types";

export const useFirestoreService = (
  { drawingId, userId }: ICommunicationProps,
  { onMessage }: ICommunicationOptions,
): ICommunicationReturnType => {
  const [unsubscribe, setUnsubscribe] = useState<Unsubscribe | null>(null);

  const sendMessage = useCallback(
    async (message: MessageStructure) => {
      console.log("send message", message);
      const docRef = doc(firestore, "drawings", drawingId);
      try {
        await setDoc(
          docRef,
          {
            timestamp: serverTimestamp(),
            userId: userId,
            type: message.type,
            payload: {
              elements: message.payload.elements,
              appState: {
                ...message.payload.appState,
                collaborators: Object.fromEntries(
                  message.payload.appState?.collaborators.entries() ??
                    new Map(),
                ),
              },
            },
          },
          {
            merge: true,
          },
        );
      } catch (error) {
        console.error("Error sending message:", error);
      }
    },
    [drawingId, userId],
  );

  const initializeConnection = useCallback(async () => {
    const docRef = doc(firestore, "drawings", drawingId);

    const unsubscribe = onSnapshot(
      docRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          console.log("Document data:", docSnapshot.data());
          const data = docSnapshot.data() as MessageStructure;
          if (data.userId === userId) return;
          onMessage(data);
        } else {
          console.log("No such document!");
        }
      },
      (error) => {
        console.log("Error getting document:", error);
        toast.error("Error getting document:", { description: error.message });
      },
    );
    setUnsubscribe(unsubscribe);
    return;
  }, [drawingId, onMessage, userId]);

  const closeConnection = useCallback(() => {
    console.log("called closeConnection, unsubscribe:", unsubscribe);
    if (unsubscribe) {
      console.log("Closing connection.");
      unsubscribe();
      setUnsubscribe(null);
    }
  }, [unsubscribe]);

  useEffect(() => {
    return () => {
      closeConnection();
    };
  }, [closeConnection]);

  return { closeConnection, sendMessage, initializeConnection, peers: [] };
};
