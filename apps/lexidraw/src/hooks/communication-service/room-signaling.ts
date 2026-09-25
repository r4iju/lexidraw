"use client";

import type { WebRtcMessage } from "@packages/types";
import { TRPCClientError } from "@trpc/client";
import { useMemo } from "react";
import { api } from "~/trpc/react";

export type DirectedSignal = {
  type: "offer" | "answer" | "iceCandidate";
  to: string;
  payload: string;
};

/** An entity's live-editing room, where peers find each other to connect. */
export type RoomSignaling = {
  /**
   * Enters the room and hears it until the returned function is called.
   * `onClosed` says whether trying again could help: not when the room
   * refused the caller.
   */
  open(handlers: {
    onMessage: (message: WebRtcMessage) => void;
    onClosed: (retry: boolean) => void;
  }): () => void;
  send(signal: DirectedSignal): Promise<void>;
  leave(): Promise<void>;
};

const REFUSED = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"]);

/** `entityId`'s room, as `peer`, through the app's `rooms` procedures. */
export function useRoomSignaling(
  entityId: string,
  peer: string,
): RoomSignaling {
  const utils = api.useUtils();
  return useMemo(() => {
    const rooms = utils.client.rooms;
    return {
      open({ onMessage, onClosed }) {
        const subscription = rooms.signals.subscribe(
          { entityId, peer },
          {
            onData: ({ data }) => onMessage(data),
            onError: (error) =>
              onClosed(
                !(
                  error instanceof TRPCClientError &&
                  REFUSED.has(String(error.data?.code))
                ),
              ),
          },
        );
        return () => subscription.unsubscribe();
      },
      send: (signal) => rooms.signal.mutate({ entityId, peer, ...signal }),
      leave: () => rooms.leave.mutate({ entityId, peer }),
    };
  }, [utils, entityId, peer]);
}
