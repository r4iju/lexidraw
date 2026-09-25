/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { WebRtcMessage } from "@packages/types";
import type { RoomSignaling } from "./room-signaling";

const { useWebRtcService } = await import("./use-web-rtc");

/** The room, as the app relays it: the test says what the client hears. */
class FakeSignaling implements RoomSignaling {
  hear: ((message: WebRtcMessage) => void) | null = null;
  left = false;
  open(handlers: { onMessage: (message: WebRtcMessage) => void }) {
    this.hear = handlers.onMessage;
    return () => {
      this.hear = null;
    };
  }
  async send() {}
  async leave() {
    this.left = true;
  }
}

/** A peer connection, whose data channel the test opens or closes. */
class FakePeerConnection {
  static last: FakePeerConnection;
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  onicecandidate = null;
  closed = false;
  constructor() {
    FakePeerConnection.last = this;
  }
  createDataChannel() {
    return new FakeChannel();
  }
  async createOffer() {
    return {};
  }
  async setLocalDescription() {}
  close() {
    this.closed = true;
  }
}

class FakeChannel {
  readyState = "open";
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {}
}

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
const SHIMMED = {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
  RTCPeerConnection: FakePeerConnection,
};
const saved = Object.keys(SHIMMED).map((key) => [key, globals[key]] as const);
beforeAll(() => Object.assign(globals, SHIMMED));
afterAll(() => {
  for (const [key, value] of saved) globals[key] = value;
});

async function openRoom(applied: unknown[] = []) {
  const signaling = new FakeSignaling();
  let service = {} as ReturnType<typeof useWebRtcService>;
  function Probe() {
    service = useWebRtcService(
      { iceServers: [], signaling },
      {
        onMessage: (message) => applied.push(message),
        onConnectionOpen: () => {},
        onConnectionClose: () => {},
      },
    );
    return null;
  }
  const root = createRoot(dom.window.document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(() => service.initializeConnection());
  const hear = (message: WebRtcMessage) =>
    act(async () => {
      signaling.hear?.(message);
    });
  const peerJoins = async (from = "peer", canEdit = true) => {
    await hear({ type: "join", from, room: "room", canEdit });
    const connection = FakePeerConnection.last;
    const channel = new FakeChannel();
    await act(async () => {
      connection.ondatachannel?.({ channel });
    });
    return { channel, connection };
  };
  return {
    signaling,
    connected: () => service.connected,
    hear,
    peerJoins,
    close: () => act(async () => service.closeConnection(true)),
    unmount: () => act(async () => root.unmount()),
  };
}

describe("whether collaborators are connected", () => {
  test("a peer is connected once its channel opens, and not after it leaves", async () => {
    const room = await openRoom();
    expect(room.connected()).toBe(false);
    await room.peerJoins();
    expect(room.connected()).toBe(true);

    await room.hear({
      type: "leave",
      from: "peer",
      room: "room",
      canEdit: true,
    });
    expect(room.connected()).toBe(false);
    await room.unmount();
  });

  test("a peer whose channel closes is no longer connected", async () => {
    const room = await openRoom();
    const { channel } = await room.peerJoins();
    await act(async () => channel.onclose?.());
    expect(room.connected()).toBe(false);
    await room.unmount();
  });

  test("a peer that joins again, from a reloaded tab, replaces its earlier connection", async () => {
    const room = await openRoom();
    const earlier = await room.peerJoins();
    const again = await room.peerJoins();
    expect(earlier.connection.closed).toBe(true);
    expect(again.connection.closed).toBe(false);
    expect(room.connected()).toBe(true);
    await room.unmount();
  });
});

const update = (userId: string) => ({
  type: "update",
  entityType: "document",
  entityId: "room",
  userId,
  payload: { elements: "{}" },
});

describe("updates from collaborators", () => {
  test("from a peer who may only read are not applied, from an editor they are", async () => {
    const applied: unknown[] = [];
    const room = await openRoom(applied);
    const reader = await room.peerJoins("reader", false);
    const editor = await room.peerJoins("editor", true);
    await act(async () => {
      reader.channel.onmessage?.({ data: JSON.stringify(update("reader")) });
      editor.channel.onmessage?.({ data: JSON.stringify(update("editor")) });
    });
    expect(applied).toEqual([update("editor")]);
    await room.unmount();
  });
});

describe("the room", () => {
  test("is left when the connection closes, so peers hear of it at once", async () => {
    const room = await openRoom();
    expect(room.signaling.left).toBe(false);
    await room.close();
    expect(room.signaling.left).toBe(true);
    expect(room.signaling.hear).toBe(null);
    await room.unmount();
  });
});
