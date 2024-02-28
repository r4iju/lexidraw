import { useCallback, useEffect, useState } from 'react';
import { type ICommunicationOptions, type ICommunicationProps, type ICommunicationReturnType } from './interface';
import { useToast } from '~/components/ui/use-toast';
import env from '@packages/env';
import { type MessageStructure } from '@packages/types';

export const useWebSocketService = (
  { drawingId, userId }: ICommunicationProps,
  { onMessage, onConnectionClose, onConnectionOpen }: ICommunicationOptions
): ICommunicationReturnType => {
  const { toast } = useToast();
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [shouldReconnect, setShouldReconnect] = useState(true);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);

  const sendMessage = useCallback((message: MessageStructure) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ ...message, drawingId: drawingId }));
    }
  }, [drawingId, socket]);

  const initializeConnection = useCallback(() => {
    const ws = new WebSocket(env.NEXT_PUBLIC_WS_SERVER);

    ws.onopen = () => {
      onConnectionOpen()
      console.log('WebSocket connection established');
      toast({ title: 'Connected', description: 'WebSocket connection established' })
      setReconnectionAttempts(0);
    };

    ws.onmessage = async (event: MessageEvent<Blob>) => {
      const parsedMessage = await event.data.text()
      console.log('received message');
      const message = JSON.parse(parsedMessage) as MessageStructure;
      if (message.userId === userId) return;
      onMessage(message);
    };

    ws.onclose = () => {
      toast({ title: 'Connection closed', description: 'WebSocket connection closed' })
      onConnectionClose();
      if (shouldReconnect) {
        const delay = Math.min(10000, (reconnectionAttempts + 1) * 1000);
        setTimeout(() => {
          setReconnectionAttempts((attempts) => attempts + 1);
          initializeConnection();
        }, delay);
      }
    };

    setSocket(ws)
  }, [onConnectionClose, onConnectionOpen, onMessage, reconnectionAttempts, shouldReconnect, toast, userId]);

  const closeConnection = useCallback(() => {
    if (socket) {
      console.log('Closing connection.');
      setShouldReconnect(false);
      socket.close();
      setSocket(null);
      onConnectionClose();
    }
  }, [onConnectionClose, socket]);

  useEffect(() => {
    return () => {
      setShouldReconnect(false);
      closeConnection()
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { closeConnection, sendMessage, initializeConnection };
};
