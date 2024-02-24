import { useCallback, useState } from 'react';
import firestore from '~/server/firestore';
import { collection, doc, setDoc, onSnapshot, query, orderBy, serverTimestamp, limit, where, type Unsubscribe } from "firebase/firestore";
import { type ICommunicationOptions, type ICommunicationProps, type ICommunicationReturnType, MessageStructure } from './interface';
import { useToast } from '~/components/ui/use-toast';

export const useFirestoreService = (
  { drawingId, userId }: ICommunicationProps,
  { onMessage }: ICommunicationOptions
): ICommunicationReturnType => {
  const { toast } = useToast();
  const [unsubscribe, setUnsubscribe] = useState<Unsubscribe | null>(null);

  const sendMessage = useCallback((message: MessageStructure) => {
    console.log('message', message)
    const messageRef = doc(collection(firestore, 'drawings', drawingId, 'messages'));
    setDoc(messageRef, {
      timestamp: serverTimestamp(),
      userId: userId,
      type: message.type,
      payload: {
        elements: message.payload.elements,
        appState: {
          ...message.payload.appState,
          collaborators: Object.fromEntries(message.payload.appState.collaborators.entries()),
        },
      }
    })
      .then(() => {
        console.log('Message sent successfully');
      })
      .catch((error) => {
        console.error('Error sending message:', error);
      });
  }, [drawingId, userId]);

  const initializeConnection = useCallback(() => {
    console.log('called initializeConnection')
    const messagesQuery = query(
      collection(firestore, 'drawings', drawingId, 'messages'),
      orderBy('timestamp', 'desc'),
      where('userId', '!=', userId),
      limit(1)
    );
    let isFirstRun = true;

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const changes = isFirstRun ? snapshot.docChanges().reverse() : snapshot.docChanges();
      changes.forEach((change) => {
        if (change?.type === 'added') {
          const parsed = MessageStructure.safeParse(change.doc.data())
          if (!parsed.success) {
            toast({
              title: 'Error parsing update',
              description: `Invalid message received from server: ${parsed.error.message}`,
              variant: "destructive",
            })
            return;
          }
          const message = change.doc.data() as MessageStructure;
          console.log('onMessage: ', message)
          onMessage(message);
        }
      });
      isFirstRun = false;
    }, (error) => {
      console.error("Error listening to messages:", error);
    });
    setUnsubscribe(unsubscribe);

    // return unsubscribe;
  }, [drawingId, onMessage, toast, userId]);

  const closeConnection = useCallback(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  }, [unsubscribe]);

  return { closeConnection, sendMessage, initializeConnection };
};
