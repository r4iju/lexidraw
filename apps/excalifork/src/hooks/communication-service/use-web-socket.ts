import { useCallback, useEffect, useState } from 'react';
import { type ICommunicationOptions, type ICommunicationProps, type ICommunicationReturnType, type MessageStructure } from './interface';
import { useToast } from '~/components/ui/use-toast';
import env from '@packages/env';

export const useWebSocketService = (
  { drawingId, userId }: ICommunicationProps,
  { onMessage }: ICommunicationOptions
): ICommunicationReturnType => {
  const { toast } = useToast();
  const [socket, setSocket] = useState<WebSocket | null>(null);


  const sendMessage = useCallback((message: MessageStructure) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ ...message, drawingId: drawingId }));
    }
  }, [drawingId, socket]);

  const initializeConnection = useCallback(() => {
    const ws = new WebSocket(env.NEXT_PUBLIC_WS_SERVER);
    ws.onopen = () => {
      console.log('WebSocket connection established');
      toast({ title: 'Connected', description: 'WebSocket connection established' })
    };
    ws.onmessage = async (event: MessageEvent<Blob>) => {
      const parsedMessage = await event.data.text()
      console.log('received: ', parsedMessage);
      const message = JSON.parse(parsedMessage) as MessageStructure;
      if (message.userId === userId) return;
      onMessage(message);
    };
    ws.onclose = () => toast({ title: 'Connection closed', description: 'WebSocket connection closed' });
    setSocket(ws)
  }, [onMessage, toast, userId]);

  const closeConnection = useCallback(() => {
    if (socket) {
      console.log('Closing connection.');
      socket.close();
      setSocket(null);
    }
  }, [socket]);

  useEffect(() => {
    return () => {
      closeConnection()
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { closeConnection, sendMessage, initializeConnection };
};
