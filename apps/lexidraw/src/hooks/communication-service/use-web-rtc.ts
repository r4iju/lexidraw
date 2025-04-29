"use client";

import { useCallback, useRef, useState } from "react";
import type {
  ICommunicationOptions,
  ICommunicationProps,
  ICommunicationReturnType,
} from "./interface";
import type { WebRtcMessage, MessageStructure } from "@packages/types";
import { useToast } from "~/components/ui/toast-provider";
import env from "@packages/env";

export function useWebRtcService(
  {
    drawingId,
    userId,
    iceServers,
  }: ICommunicationProps & { iceServers: RTCIceServer[] },
  { onMessage, onConnectionClose, onConnectionOpen }: ICommunicationOptions,
): ICommunicationReturnType {
  const { toast } = useToast();

  const shouldReconnectRef = useRef(true);
  const reconnectionAttemptsRef = useRef(0);
  const onConnectionCloseRef = useRef(onConnectionClose);

  const websocket = useRef<WebSocket | null>(null);
  const localConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());

  const [peers, setPeers] = useState<string[]>([]);

  const handleParticipantLeft = useCallback((clientId: string) => {
    console.log("Participant left:", clientId);
    localConnections.current.get(clientId)?.close();
    localConnections.current.delete(clientId);
    dataChannels.current.get(clientId)?.close();
    dataChannels.current.delete(clientId);
    setPeers(Array.from(localConnections.current.keys()));
  }, []);

  const setupPeerConnection = useCallback(
    (clientId: string) => {
      if (!websocket.current) {
        throw new Error("WebSocket connection not established");
      }
      const config = { iceServers } satisfies RTCConfiguration;
      const conn = new RTCPeerConnection(config);

      conn.onicecandidate = (event) => {
        if (event.candidate && websocket.current?.OPEN) {
          websocket.current?.send(
            JSON.stringify({
              room: drawingId,
              to: clientId,
              from: userId,
              type: "iceCandidate",
              candidate: JSON.stringify(event.candidate),
            } satisfies WebRtcMessage),
          );
        }
      };

      const channel = conn.createDataChannel("dataChannel");
      channel.onopen = () => console.log("Data channel open");
      channel.onclose = () => {
        console.log("channel closed");
        if (dataChannels.current.has(clientId)) {
          dataChannels.current.delete(clientId);
        }
      };
      channel.onmessage = (event: MessageEvent<string>) => {
        onMessage(JSON.parse(event.data) as MessageStructure);
      };

      conn.ondatachannel = (event) => {
        console.log("Data channel received");
        const receiveChannel = event.channel;
        receiveChannel.onmessage = (event: MessageEvent<string>) => {
          onMessage(JSON.parse(event.data) as MessageStructure);
        };
        receiveChannel.onclose = () => {
          console.log("receiveChannel closed");
          if (dataChannels.current.has(clientId)) {
            dataChannels.current.delete(clientId);
          }
        };
        dataChannels.current.set(clientId, receiveChannel);
        onConnectionOpen();
      };

      localConnections.current.set(clientId, conn);
      setPeers(Array.from(localConnections.current.keys()));
      return conn;
    },
    [drawingId, userId, iceServers, onMessage, onConnectionOpen],
  );

  const handleParticipantJoined = useCallback(
    async (clientId: string) => {
      console.log("Participant joined:", clientId);
      const peerConnection = setupPeerConnection(clientId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (websocket.current?.OPEN) {
        websocket.current?.send(
          JSON.stringify({
            room: drawingId,
            to: clientId,
            from: userId,
            type: "offer",
            offer: JSON.stringify(offer),
          } satisfies WebRtcMessage),
        );
      }
    },
    [drawingId, setupPeerConnection, userId],
  );

  const handleRemoteOffer = useCallback(
    async (clientId: string, offer: string) => {
      console.log("Handling remote offer");
      const peerConnection = setupPeerConnection(clientId);
      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(
            JSON.parse(offer) as RTCSessionDescriptionInit,
          ),
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        if (websocket.current?.OPEN) {
          websocket.current?.send(
            JSON.stringify({
              room: drawingId,
              from: userId,
              to: clientId,
              type: "answer",
              answer: JSON.stringify(answer),
            } satisfies WebRtcMessage),
          );
        }
      } catch (error) {
        console.error("Failed to handle remote offer:", error);
      }
    },
    [drawingId, setupPeerConnection, userId],
  );

  const handleRemoteAnswer = useCallback(
    async (clientId: string, answer: string) => {
      console.log("Handling remote answer for ", clientId);
      const peerConnection = localConnections.current?.get(clientId);
      if (!peerConnection) {
        console.error("Local connection not established");
        return;
      }

      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(
            JSON.parse(answer) as RTCSessionDescriptionInit,
          ),
        );
      } catch (error) {
        console.error("Failed to handle remote answer:", error);
      }
    },
    [],
  );

  const handleIceCandidate = useCallback(
    async (clientId: string, candidate: string) => {
      console.log("Handling ice candidate");
      const peerConnection = localConnections.current?.get(clientId);
      if (!peerConnection) {
        console.error("Local connection not established");
        return;
      }

      try {
        await peerConnection.addIceCandidate(
          new RTCIceCandidate(JSON.parse(candidate) as RTCIceCandidateInit),
        );
      } catch (error) {
        console.error("Failed to handle ICE candidate:", error);
      }
    },
    [],
  );

  const initializeConnection = useCallback(async () => {
    // check if we're already connected or if we're connecting
    if (websocket.current && websocket.current.readyState === WebSocket.OPEN) {
      console.log("Already connected");
      return;
    }
    if (
      websocket.current &&
      websocket.current.readyState === WebSocket.CONNECTING
    ) {
      console.log("Already connecting");
      return;
    }
    console.log("Initializing WebSocket connection");

    const ws = new WebSocket(env.NEXT_PUBLIC_WS_SERVER);
    websocket.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connection established");
      ws.send(
        JSON.stringify({
          room: drawingId,
          from: userId,
          type: "join",
        } satisfies WebRtcMessage),
      );
    };

    ws.onmessage = async (event: MessageEvent<string>) => {
      console.log("received websocket message: ", event.data);
      const message = JSON.parse(event.data) as WebRtcMessage;
      const clientId = message.from;
      // Handle different types of messages (offer, answer, ICE candidate)
      switch (message.type) {
        case "offer":
          await handleRemoteOffer(clientId, message.offer);
          break;
        case "answer":
          await handleRemoteAnswer(clientId, message.answer);
          break;
        case "iceCandidate":
          await handleIceCandidate(clientId, message.candidate);
          break;
        case "leave":
          handleParticipantLeft(clientId);
          break;
        case "join":
          handleParticipantJoined(clientId);
          break;
        default:
          console.log("Unknown message type:", message satisfies never);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
      if (shouldReconnectRef.current) {
        const delay = Math.min(
          10000,
          (reconnectionAttemptsRef.current + 1) * 1000,
        );
        setTimeout(() => {
          reconnectionAttemptsRef.current += 1;
          initializeConnection()
            .then(() => console.log("Reconnecting websocket connection..."))
            .catch(console.error);
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }, [
    drawingId,
    handleIceCandidate,
    handleParticipantJoined,
    handleParticipantLeft,
    handleRemoteAnswer,
    handleRemoteOffer,
    userId,
  ]);

  const closeConnection = useCallback(
    (muted = false) => {
      shouldReconnectRef.current = false;
      reconnectionAttemptsRef.current = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_, conn] of localConnections.current) {
        conn.close();
      }
      localConnections.current = new Map();
      setPeers([]);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_, channel] of dataChannels.current) {
        channel.close();
      }
      dataChannels.current = new Map();
      if (websocket.current) {
        websocket.current.close();
        websocket.current = null;
      }
      if (!muted) {
        toast({
          title: "Connection closed",
          variant: "default",
        });
      }
      onConnectionCloseRef.current();
    },
    [toast],
  );

  const sendMessage = useCallback((message: MessageStructure) => {
    dataChannels.current.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(message));
      } else {
        console.warn("Data channel not open");
      }
    });
  }, []);

  return { closeConnection, sendMessage, initializeConnection, peers };
}
