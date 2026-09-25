import type { WebRtcMessage } from "@packages/types";

/**
 * Which peers in a room may edit, as the room reports it: every message it
 * passes on carries its sender's `canEdit`. Updates are applied only from a
 * peer the room has said may edit.
 */
export class PeerAccess {
  private readonly editors = new Set<string>();

  heard(message: WebRtcMessage) {
    if (message.type === "leave" || !message.canEdit) {
      this.forget(message.from);
    } else {
      this.editors.add(message.from);
    }
  }

  forget(peer: string) {
    this.editors.delete(peer);
  }

  /** Whether an update that arrived over `peer`'s channel may be applied. */
  accepts(peer: string) {
    return this.editors.has(peer);
  }
}
