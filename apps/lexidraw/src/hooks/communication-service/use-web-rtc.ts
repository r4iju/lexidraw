"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ICommunicationOptions,
  ICommunicationProps,
  ICommunicationReturnType,
} from "./interface";
import type { WebRtcMessage, MessageStructure } from "@packages/types";
import { toast } from "sonner";
import env from "@packages/env";
import { PeerAccess } from "./peer-access";

/**
 * `connected` says whether any collaborator's channel is open, and follows
 * them as they come and go.
 */
export function useWebRtcService(
  {
    drawingId,
    userId,
    iceServers,
    getRoomToken,
  }: ICommunicationProps & {
    iceServers: RTCIceServer[];
    /**
     * A token for the signaling server, asked for on every connect; see
     * `useRoomToken`. Null, or no function at all, connects without one.
     */
    getRoomToken?: () => Promise<string | null>;
  },
  { onMessage, onConnectionClose, onConnectionOpen }: ICommunicationOptions,
): ICommunicationReturnType & { connected: boolean } {
  const shouldReconnectRef = useRef(true);
  const reconnectionAttemptsRef = useRef(0);
  const onConnectionCloseRef = useRef(onConnectionClose);

  const websocket = useRef<WebSocket | null>(null);
  const localConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());
  const peerAccess = useRef(new PeerAccess());
  const connecting = useRef(false);
  const getRoomTokenRef = useRef(getRoomToken);
  useEffect(() => {
    getRoomTokenRef.current = getRoomToken;
  }, [getRoomToken]);

  // Updates from a peer the signaling server says may only read are dropped.
  const receive = useCallback(
    (clientId: string, event: MessageEvent<string>) => {
      if (!peerAccess.current.accepts(clientId)) {
        console.warn("Ignoring an update from a read-only peer:", clientId);
        return;
      }
      onMessage(JSON.parse(event.data) as MessageStructure);
    },
    [onMessage],
  );

  const [peers, setPeers] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const channelsChanged = useCallback(() => {
    setConnected(dataChannels.current.size > 0);
  }, []);

  const handleParticipantLeft = useCallback(
    (clientId: string) => {
      console.log("Participant left:", clientId);
      peerAccess.current.forget(clientId);
      localConnections.current.get(clientId)?.close();
      localConnections.current.delete(clientId);
      dataChannels.current.get(clientId)?.close();
      dataChannels.current.delete(clientId);
      setPeers(Array.from(localConnections.current.keys()));
      channelsChanged();
    },
    [channelsChanged],
  );

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
        channelsChanged();
      };
      channel.onmessage = (event: MessageEvent<string>) => {
        receive(clientId, event);
      };

      conn.ondatachannel = (event) => {
        console.log("Data channel received");
        const receiveChannel = event.channel;
        receiveChannel.onmessage = (event: MessageEvent<string>) => {
          receive(clientId, event);
        };
        receiveChannel.onclose = () => {
          console.log("receiveChannel closed");
          if (dataChannels.current.get(clientId) === receiveChannel) {
            dataChannels.current.delete(clientId);
          }
          channelsChanged();
        };
        dataChannels.current.set(clientId, receiveChannel);
        channelsChanged();
        onConnectionOpen();
      };

      localConnections.current.set(clientId, conn);
      setPeers(Array.from(localConnections.current.keys()));
      return conn;
    },
    [drawingId, userId, iceServers, receive, onConnectionOpen, channelsChanged],
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

  const initializeConnectionRef = useRef<() => Promise<void>>(null);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    const delay = Math.min(10000, (reconnectionAttemptsRef.current + 1) * 1000);
    setTimeout(() => {
      reconnectionAttemptsRef.current += 1;
      initializeConnectionRef
        .current?.()
        .then(() => console.log("Reconnecting websocket connection..."))
        .catch(console.error);
    }, delay);
  }, []);

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
    if (connecting.current) {
      console.log("Already connecting");
      return;
    }
    console.log("Initializing WebSocket connection");

    // A signaling server with a secret wants a room token, which the app
    // issues when it holds the same secret. Without one, the client connects
    // as it always has.
    let token: string | null;
    connecting.current = true;
    try {
      token = (await getRoomTokenRef.current?.()) ?? null;
    } catch (error) {
      console.error("Could not get a room token:", error);
      connecting.current = false;
      scheduleReconnect();
      return;
    }
    connecting.current = false;

    const ws = new WebSocket(
      token
        ? withRoomToken(env.NEXT_PUBLIC_WS_SERVER, token)
        : env.NEXT_PUBLIC_WS_SERVER,
    );
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
      peerAccess.current.heard(message);
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
      scheduleReconnect();
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
    scheduleReconnect,
    userId,
  ]);

  useEffect(() => {
    initializeConnectionRef.current = initializeConnection;
  }, [initializeConnection]);

  const closeConnection = useCallback((muted = false) => {
    shouldReconnectRef.current = false;
    reconnectionAttemptsRef.current = 0;

    for (const [_, conn] of localConnections.current) {
      conn.close();
    }
    localConnections.current = new Map();
    peerAccess.current = new PeerAccess();
    setPeers([]);

    for (const [_, channel] of dataChannels.current) {
      channel.close();
    }
    dataChannels.current = new Map();
    setConnected(false);
    if (websocket.current) {
      websocket.current.close();
      websocket.current = null;
    }
    if (!muted) {
      toast("Connection closed");
    }
    onConnectionCloseRef.current();
  }, []);

  const sendMessage = useCallback((message: MessageStructure) => {
    for (const channel of dataChannels.current.values()) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(message));
      } else {
        console.warn("Data channel not open");
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      closeConnection(true);
    };
  }, [closeConnection]);

  return {
    closeConnection,
    sendMessage,
    initializeConnection,
    peers,
    connected,
  };
}

function withRoomToken(server: string, token: string) {
  const url = new URL(server);
  url.searchParams.set("token", token);
  return url;
}
