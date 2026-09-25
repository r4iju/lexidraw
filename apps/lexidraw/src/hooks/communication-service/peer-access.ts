import type { WebRtcMessage } from "@packages/types";

/**
 * Which peers in a room may only read, as the signaling server reports it.
 * A server that checks room tokens stamps every message it relays with the
 * sender's `canEdit`; updates from a peer marked read-only are not applied.
 * A peer the server says nothing about is trusted as before, which is what a
 * server without a secret, or an app that issues no tokens, amounts to.
 */
export class PeerAccess {
  private readonly readOnly = new Set<string>();

  heard(message: WebRtcMessage) {
    if (message.type === "leave") {
      this.forget(message.from);
    } else if (message.canEdit === false) {
      this.readOnly.add(message.from);
    } else if (message.canEdit === true) {
      this.readOnly.delete(message.from);
    }
  }

  forget(peer: string) {
    this.readOnly.delete(peer);
  }

  /** Whether an update that arrived over `peer`'s channel may be applied. */
  accepts(peer: string) {
    return !this.readOnly.has(peer);
  }
}
