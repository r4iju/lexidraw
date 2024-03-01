"use client";

import { useCallback, useRef, useState } from 'react';
import type { ICommunicationOptions, ICommunicationProps, ICommunicationReturnType } from './interface';
import type { WebRtcMessage, MessageStructure } from '@packages/types';
import { useToast } from '~/components/ui/use-toast';
import env from '@packages/env';

export function useWebRtcService(
  { drawingId, userId, iceServers }: ICommunicationProps & { iceServers: RTCIceServer[] },
  { onMessage, onConnectionClose, onConnectionOpen }: ICommunicationOptions
): ICommunicationReturnType {
  const { toast } = useToast();
  const [shouldReconnect, setShouldReconnect] = useState(true);
  const [reconnectionAttempts, setReconnectionAttempts] = useState(0);
  const websocket = useRef<WebSocket | null>(null);
  const localConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);

  const handleRemoteOffer = useCallback(async (offer: string) => {
    if (!localConnection.current) {
      console.error('Local connection not established');
      return;
    };

    try {
      await localConnection.current?.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer) as RTCSessionDescriptionInit));
      const answer = await localConnection.current?.createAnswer();
      await localConnection.current?.setLocalDescription(answer);
      websocket.current?.send(JSON.stringify({ action: 'send', room: drawingId, userId, type: 'answer', answer: JSON.stringify(answer) }));
    } catch (error) {
      console.error("Failed to handle remote offer:", error);
    }
  }, [drawingId, userId, websocket]);

  const handleRemoteAnswer = useCallback(async (answer: string) => {
    if (!localConnection.current) {
      console.error('Local connection not established');
      return;
    };

    try {
      await localConnection.current?.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer) as RTCSessionDescriptionInit));
    } catch (error) {
      console.error("Failed to handle remote answer:", error);
    }
  }, []);

  const handleIceCandidate = useCallback(async (candidate: string) => {
    if (!localConnection.current) {
      console.error('Local connection not established');
      return;
    };

    try {
      await localConnection.current.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate) as RTCIceCandidateInit));
    } catch (error) {
      console.error("Failed to handle ICE candidate:", error);
    }
  }, [])

  const setupPeerConnection = useCallback(() => {
    if (!websocket.current) {
      console.error('WebSocket connection not established');
      return;
    }
    const config = { iceServers } satisfies RTCConfiguration;
    const conn = new RTCPeerConnection(config);

    conn.onicecandidate = event => {
      if (event.candidate && websocket) {
        websocket.current?.send(JSON.stringify({
          action: 'send',
          room: drawingId,
          userId,
          type: 'iceCandidate',
          candidate: JSON.stringify(event.candidate)
        }));
      }
    };

    const channel = conn.createDataChannel("dataChannel");
    channel.onopen = () => console.log("Data channel open");
    channel.onclose = () => console.log("Data channel closed");
    channel.onmessage = (event: MessageEvent<string>) => {
      onMessage(JSON.parse(event.data) as MessageStructure)
    };
    // dataChannel.current = channel;

    // Set up handlers for receiving data channel and tracks
    conn.ondatachannel = event => {
      console.log('Data channel received')
      const receiveChannel = event.channel;
      receiveChannel.onmessage = (event: MessageEvent<string>) => {
        onMessage(JSON.parse(event.data) as MessageStructure)
      };
      dataChannel.current = receiveChannel;
      onConnectionOpen();
    };

    localConnection.current = conn;
    return conn;
  }, [drawingId, userId, iceServers, onMessage, onConnectionOpen]);

  const initializeConnection = useCallback(async () => {
    console.log('Initializing WebSocket connection');

    const ws = new WebSocket(env.NEXT_PUBLIC_WS_SERVER);
    websocket.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connection established');
      setupPeerConnection()
      ws.send(JSON.stringify({
        action: 'join',
        room: drawingId,
        userId,
        type: "connection"
      } satisfies WebRtcMessage));
    };

    ws.onmessage = async (event: MessageEvent<string>) => {
      console.log('received websocket message: ', event.data);
      const message = JSON.parse(event.data) as WebRtcMessage;
      // Handle different types of messages (offer, answer, ICE candidate)
      switch (message.type) {
        case 'offer':
          await handleRemoteOffer(message.offer);
          break;
        case 'answer':
          await handleRemoteAnswer(message.answer);
          break;
        case 'iceCandidate':
          await handleIceCandidate(message.candidate);
          break;
        case 'connection':
          console.log('New participant connected:', message.userId);
          break;
        case 'initiateOffer':
          if (!localConnection || !websocket) {
            console.error('localconnection or websocket is not available', { localConnection, websocket });
            return;
          }
          if (localConnection) {
            console.log('Creating offer');
            const offer = await localConnection.current?.createOffer();
            await localConnection.current?.setLocalDescription(offer);
            websocket.current?.send(JSON.stringify({
              action: 'send',
              room: drawingId,
              userId,
              type: 'offer',
              offer: JSON.stringify(offer)
            }));
          }
          break;
        default:
          console.log('Unknown message type:', message satisfies never);
      }
    };

    ws.onclose = () => {
      toast({ title: 'Connection closed', description: 'WebSocket connection closed' })
      if (shouldReconnect) {
        const delay = Math.min(10000, (reconnectionAttempts + 1) * 1000);
        setTimeout(() => {
          setReconnectionAttempts((attempts) => attempts + 1);
          initializeConnection()
            .then(() => console.log('Reconnecting...'))
            .catch(console.error);
        }, delay);
      }
    };
  }, [drawingId, handleIceCandidate, handleRemoteAnswer, handleRemoteOffer, reconnectionAttempts, setupPeerConnection, shouldReconnect, toast, userId]);

  const closeConnection = useCallback(() => {
    if (localConnection.current) {
      localConnection.current.close();
      localConnection.current = null;
    }
    if (dataChannel.current) {
      dataChannel.current.close();
      dataChannel.current = null;
    }
    if (websocket.current) {
      setShouldReconnect(false);
      websocket.current.close();
      websocket.current = null;
    }
    onConnectionClose();
  }, [onConnectionClose]);


  const sendMessage = useCallback((message: MessageStructure) => {
    console.log('sending message', message);
    console.log('dataChannel: ', dataChannel.current?.readyState);
    if (dataChannel && dataChannel.current?.readyState === 'open') {
      dataChannel.current?.send(JSON.stringify(message));
    }
  }, []);

  return { closeConnection, sendMessage, initializeConnection };
}
