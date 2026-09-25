/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The validated env wants a variable `.env.test` has no reason to carry; see
// `test/server-runtime.ts`.
(process.env as Record<string, string | undefined>).MEDIA_DOWNLOADER_URL ??=
  "http://media-downloader.test";
const { useWebRtcService } = await import("./use-web-rtc");
const { default: env } = await import("@packages/env");

/** The signalling server's socket: the test says what it hears. */
class FakeWebSocket {
  static last: FakeWebSocket;
  static OPEN = 1;
  readyState = 0;
  OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.last = this;
  }
  send() {}
  close() {}
}

/** A peer connection, whose data channel the test opens or closes. */
class FakePeerConnection {
  static last: FakePeerConnection;
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  onicecandidate = null;
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
  close() {}
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
  WebSocket: FakeWebSocket,
  RTCPeerConnection: FakePeerConnection,
};
const saved = Object.keys(SHIMMED).map((key) => [key, globals[key]] as const);
beforeAll(() => Object.assign(globals, SHIMMED));
afterAll(() => {
  for (const [key, value] of saved) globals[key] = value;
});

async function openRoom(
  getRoomToken?: () => Promise<string | null>,
  applied: unknown[] = [],
) {
  let service = {} as ReturnType<typeof useWebRtcService>;
  function Probe() {
    service = useWebRtcService(
      { drawingId: "room", userId: "me", iceServers: [], getRoomToken },
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
  const hear = (message: object) =>
    act(async () => {
      await FakeWebSocket.last.onmessage?.({ data: JSON.stringify(message) });
    });
  const peerJoins = async (from = "peer", canEdit?: boolean) => {
    await hear({ type: "join", from, room: "room", canEdit });
    const channel = new FakeChannel();
    await act(async () => {
      FakePeerConnection.last.ondatachannel?.({ channel });
    });
    return channel;
  };
  return {
    url: () => FakeWebSocket.last.url,
    connected: () => service.connected,
    hear,
    peerJoins,
    close: () => act(async () => root.unmount()),
  };
}

describe("whether collaborators are connected", () => {
  test("a peer is connected once its channel opens, and not after it leaves", async () => {
    const room = await openRoom();
    expect(room.connected()).toBe(false);
    await room.peerJoins();
    expect(room.connected()).toBe(true);

    await room.hear({ type: "leave", from: "peer", room: "room" });
    expect(room.connected()).toBe(false);
    await room.close();
  });

  test("a peer whose channel closes is no longer connected", async () => {
    const room = await openRoom();
    const channel = await room.peerJoins();
    await act(async () => channel.onclose?.());
    expect(room.connected()).toBe(false);
    await room.close();
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
    const room = await openRoom(async () => "a-token", applied);
    const reader = await room.peerJoins("reader", false);
    const editor = await room.peerJoins("editor", true);
    await act(async () => {
      reader.onmessage?.({ data: JSON.stringify(update("reader")) });
      editor.onmessage?.({ data: JSON.stringify(update("editor")) });
    });
    expect(applied).toEqual([update("editor")]);
    await room.close();
  });

  test("are applied as before when the signaling server says nothing about access", async () => {
    const applied: unknown[] = [];
    const room = await openRoom(undefined, applied);
    const peer = await room.peerJoins();
    await act(async () => {
      peer.onmessage?.({ data: JSON.stringify(update("peer")) });
    });
    expect(applied).toEqual([update("peer")]);
    await room.close();
  });
});

describe("connecting to the signaling server", () => {
  test("carries the room token when the app issues one", async () => {
    const room = await openRoom(async () => "a-token");
    expect(new URL(room.url()).searchParams.get("token")).toBe("a-token");
    await room.close();
  });

  test("uses the server's address as it is when the app issues none", async () => {
    const room = await openRoom(async () => null);
    expect(room.url()).toBe(env.NEXT_PUBLIC_WS_SERVER);
    await room.close();
  });
});
