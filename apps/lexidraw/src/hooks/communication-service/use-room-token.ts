"use client";

import { useCallback } from "react";
import { api } from "~/trpc/react";

/**
 * Asks the app for a signaling room token for `entityId`, as `peer`, each
 * time it is called, since a token is only good for a few minutes. It comes
 * back null while the app has no `SIGNALING_SECRET`.
 */
export function useRoomToken(entityId: string, peer: string) {
  const utils = api.useUtils();
  return useCallback(async () => {
    const { token } = await utils.client.entities.roomToken.query({
      id: entityId,
      peer,
    });
    return token;
  }, [utils, entityId, peer]);
}
