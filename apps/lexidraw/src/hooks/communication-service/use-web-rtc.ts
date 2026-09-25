"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ICommunicationOptions,
  ICommunicationReturnType,
} from "./interface";
import type { WebRtcMessage, MessageStructure } from "@packages/types";
import { toast } from "sonner";
import { PeerAccess } from "./peer-access";
import type { DirectedSignal, RoomSignaling } from "./room-signaling";

/**
 * `connected` says whether any collaborator's channel is open, and follows
 * them as they come and go.
 */
export function useWebRtcService(
  {
    iceServers,
    signaling,
  }: {
    iceServers: RTCIceServer[];
    /** Where peers find each other; see `useRoomSignaling`. */
    signaling: RoomSignaling;
  },
  { onMessage, onConnectionClose, onConnectionOpen }: ICommunicationOptions,
): ICommunicationReturnType & { connected: boolean } {
  const shouldReconnectRef = useRef(true);
  const reconnectionAttemptsRef = useRef(0);
  const onConnectionCloseRef = useRef(onConnectionClose);

  const leaveRoomStream = useRef<(() => void) | null>(null);
  const localConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());
  const peerAccess = useRef(new PeerAccess());

  const signal = useCallback(
    (message: DirectedSignal) => {
      signaling.send(message).catch((error: unknown) => {
        console.error(`Could not send ${message.type}:`, error);
      });
    },
    [signaling],
  );

  // Updates from a peer the room does not say may edit are dropped.
  const receive = useCallback(
    (clientId: string, event: MessageEvent<string>) => {
      if (!peerAccess.current.accepts(clientId)) {
        console.warn(
          "Ignoring an update from a peer who may not edit:",
          clientId,
        );
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
      // A peer that joins again, say from a reloaded tab, starts over.
      localConnections.current.get(clientId)?.close();
      dataChannels.current.get(clientId)?.close();
      dataChannels.current.delete(clientId);

      const config = { iceServers } satisfies RTCConfiguration;
      const conn = new RTCPeerConnection(config);
      const isCurrent = () => localConnections.current.get(clientId) === conn;

      conn.onicecandidate = (event) => {
        if (event.candidate) {
          signal({
            type: "iceCandidate",
            to: clientId,
            payload: JSON.stringify(event.candidate),
          });
        }
      };

      const channel = conn.createDataChannel("dataChannel");
      channel.onopen = () => console.log("Data channel open");
      channel.onclose = () => {
        console.log("channel closed");
        if (isCurrent()) dataChannels.current.delete(clientId);
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
    [iceServers, signal, receive, onConnectionOpen, channelsChanged],
  );

  const handleParticipantJoined = useCallback(
    async (clientId: string) => {
      console.log("Participant joined:", clientId);
      const peerConnection = setupPeerConnection(clientId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      signal({ type: "offer", to: clientId, payload: JSON.stringify(offer) });
    },
    [setupPeerConnection, signal],
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
        signal({
          type: "answer",
          to: clientId,
          payload: JSON.stringify(answer),
        });
      } catch (error) {
        console.error("Failed to handle remote offer:", error);
      }
    },
    [setupPeerConnection, signal],
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
        .then(() => console.log("Rejoining the room..."))
        .catch(console.error);
    }, delay);
  }, []);

  const handleSignal = useCallback(
    async (message: WebRtcMessage) => {
      const clientId = message.from;
      peerAccess.current.heard(message);
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
          await handleParticipantJoined(clientId);
          break;
        default:
          console.log("Unknown message type:", message satisfies never);
      }
    },
    [
      handleIceCandidate,
      handleParticipantJoined,
      handleParticipantLeft,
      handleRemoteAnswer,
      handleRemoteOffer,
    ],
  );

  const initializeConnection = useCallback(async () => {
    if (leaveRoomStream.current) {
      console.log("Already in the room");
      return;
    }
    console.log("Joining the room");
    shouldReconnectRef.current = true;
    leaveRoomStream.current = signaling.open({
      onMessage: (message) => {
        reconnectionAttemptsRef.current = 0;
        handleSignal(message).catch(console.error);
      },
      onClosed: (retry) => {
        console.log("The room closed", retry ? "; rejoining" : "");
        leaveRoomStream.current = null;
        if (retry) scheduleReconnect();
      },
    });
  }, [handleSignal, scheduleReconnect, signaling]);

  useEffect(() => {
    initializeConnectionRef.current = initializeConnection;
  }, [initializeConnection]);

  const closeConnection = useCallback(
    (muted = false) => {
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
      if (leaveRoomStream.current) {
        leaveRoomStream.current();
        leaveRoomStream.current = null;
        signaling.leave().catch((error: unknown) => {
          console.error("Could not leave the room:", error);
        });
      }
      if (!muted) {
        toast("Connection closed");
      }
      onConnectionCloseRef.current();
    },
    [signaling],
  );

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
