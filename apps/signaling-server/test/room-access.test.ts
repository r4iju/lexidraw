import type { WebRtcMessage } from "@packages/types";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { signRoomToken } from "../src/room-token.js";
import { startServer } from "../src/server.js";

const SECRET = "a-secret-long-enough-to-sign-rooms-with";
let nextPort = 58300;
const running: { stop(): void }[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of running.splice(0)) server.stop();
});

function serve(secret?: string) {
  const port = nextPort++;
  running.push(startServer(port, { secret, log: () => {} }));
  return port;
}

type Peer = {
  socket: WebSocket;
  received: WebRtcMessage[];
  closed: Promise<number>;
};

async function connect(port: number, token?: string): Promise<Peer> {
  const url = new URL(`ws://localhost:${port}`);
  if (token) url.searchParams.set("token", token);
  const socket = new WebSocket(url);
  sockets.push(socket);
  const received: WebRtcMessage[] = [];
  socket.on("message", (data) => {
    received.push(JSON.parse(String(data)) as WebRtcMessage);
  });
  const closed = new Promise<number>((resolve) => {
    socket.on("close", (code) => resolve(code));
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  return { socket, received, closed };
}

const send = (peer: Peer, message: Record<string, unknown>) =>
  peer.socket.send(JSON.stringify(message));

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const token = (room: string, peer: string, canEdit: boolean, exp = 60_000) =>
  signRoomToken(SECRET, { room, peer, canEdit, exp: Date.now() + exp });

describe("without a secret", () => {
  test("anyone joins a room without a token, as before", async () => {
    const port = serve();
    const first = await connect(port);
    const second = await connect(port);
    send(first, { type: "join", room: "room-a", from: "first" });
    await settle();
    send(second, { type: "join", room: "room-a", from: "second" });
    await settle();
    expect(first.received).toEqual([
      { type: "join", room: "room-a", from: "second" },
    ]);
  });
});

describe("with a secret", () => {
  test("a peer with a token joins, and the room hears what they may do", async () => {
    const port = serve(SECRET);
    const editor = await connect(port, token("room-a", "editor", true));
    const reader = await connect(port, token("room-a", "reader", false));
    send(editor, { type: "join", room: "room-a", from: "editor" });
    await settle();
    // What a peer claims about itself is not what the room is told.
    send(reader, {
      type: "join",
      room: "room-a",
      from: "reader",
      canEdit: true,
    });
    await settle();
    send(editor, {
      type: "offer",
      room: "room-a",
      from: "editor",
      to: "reader",
      offer: "{}",
    });
    await settle();
    expect(editor.received).toEqual([
      { type: "join", room: "room-a", from: "reader", canEdit: false },
    ]);
    expect(reader.received).toEqual([
      {
        type: "offer",
        room: "room-a",
        from: "editor",
        to: "reader",
        offer: "{}",
        canEdit: true,
      },
    ]);
  });

  test("a peer with an expired or forged token is turned away", async () => {
    const port = serve(SECRET);
    const forged = signRoomToken("some-other-secret-of-the-same-length!!", {
      room: "room-a",
      peer: "x",
      canEdit: true,
      exp: Date.now() + 60_000,
    });
    for (const presented of [token("room-a", "x", true, -1), forged, "junk"]) {
      const peer = await connect(port, presented);
      expect(await peer.closed).toBe(4401);
    }
  });

  test("peers without a token still meet each other, but never a peer that holds one", async () => {
    const port = serve(SECRET);
    const holder = await connect(port, token("room-a", "holder", true));
    const first = await connect(port);
    const second = await connect(port);
    send(holder, { type: "join", room: "room-a", from: "holder" });
    await settle();
    send(first, { type: "join", room: "room-a", from: "first" });
    await settle();
    send(second, { type: "join", room: "room-a", from: "second" });
    await settle();
    // Nor can a peer without a token reach the holder by name.
    send(second, {
      type: "offer",
      room: "room-a",
      from: "second",
      to: "holder",
      offer: "{}",
    });
    await settle();
    expect(holder.received).toEqual([]);
    expect(first.received).toEqual([
      { type: "join", room: "room-a", from: "second" },
    ]);
  });

  test("a token for one room does not open another, nor speak for someone else", async () => {
    const port = serve(SECRET);
    const member = await connect(port, token("room-b", "member", true));
    send(member, { type: "join", room: "room-b", from: "member" });
    await settle();

    const elsewhere = await connect(port, token("room-a", "intruder", true));
    send(elsewhere, { type: "join", room: "room-b", from: "intruder" });
    expect(await elsewhere.closed).toBe(4403);

    const impostor = await connect(port, token("room-b", "intruder", true));
    send(impostor, { type: "join", room: "room-b", from: "member-2" });
    expect(await impostor.closed).toBe(4403);

    await settle();
    expect(member.received).toEqual([]);
  });
});
