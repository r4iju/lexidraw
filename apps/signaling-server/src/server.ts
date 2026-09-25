import type { WebRtcMessage } from "@packages/types";
import { type WebSocket, WebSocketServer } from "ws";
import { type RoomTokenClaims, verifyRoomToken } from "./room-token.js";

type Client = {
  ws: WebSocket;
  userId: string;
};

type Room = Map<string, Client>;

export type ServerOptions = {
  /**
   * The secret the app signs room tokens with. Without one, any client may
   * join any room as anyone, which is how the server has always behaved.
   */
  secret?: string;
  log?: (message: string) => void;
};

/** The token was missing its signature, forged, or expired. */
const REFUSED = 4401;
/** The token is fine, but not for the room or peer the client spoke as. */
const OUT_OF_BOUNDS = 4403;

export function startServer(port = 8080, options: ServerOptions = {}) {
  const log = options.log ?? console.log;
  const secret = options.secret || undefined;
  const wss = new WebSocketServer({ port });

  // Peers holding a token meet only each other. With a secret, peers without
  // one still meet each other, as before, so an app that does not issue
  // tokens yet keeps working; they never meet a peer that holds one.
  const rooms = new Map<string, Room>();
  const tokenlessRooms = new Map<string, Room>();

  wss.on("connection", (ws: WebSocket, request) => {
    let claims: RoomTokenClaims | null = null;
    if (secret) {
      const token = new URL(
        request.url ?? "/",
        "ws://localhost",
      ).searchParams.get("token");
      if (token !== null) {
        claims = verifyRoomToken(secret, token);
        if (!claims) {
          ws.close(REFUSED, "Room token not accepted");
          return;
        }
      }
    }
    const chosen = claims || !secret ? rooms : tokenlessRooms;

    ws.on("message", (msg: string) => {
      let message: WebRtcMessage;
      try {
        message = JSON.parse(msg) as WebRtcMessage;
      } catch {
        return;
      }

      if (claims) {
        if (message.room !== claims.room || message.from !== claims.peer) {
          ws.close(OUT_OF_BOUNDS, "Room token is for another room or peer");
          return;
        }
        // What peers are told about each other's access is the token's, not
        // what the sender says.
        message = { ...message, canEdit: claims.canEdit };
      }

      relay(chosen, ws, message);
    });

    ws.on("close", () => {
      // Remove the client from all rooms
      for (const [roomId, room] of chosen) {
        for (const [clientId, client] of room) {
          if (client.ws === ws) {
            room.delete(clientId);
            // also notify all peers
            for (const [_, peer] of room) {
              peer.ws.send(
                JSON.stringify({
                  room: roomId,
                  from: clientId,
                  type: "leave",
                } satisfies WebRtcMessage),
              );
            }
          }
        }
        if (room.size === 0) {
          chosen.delete(roomId); // Clean up empty rooms
        }
      }
    });
  });

  log(`WebSocket server started on ws://localhost:${port}`);
  if (!secret) {
    log(
      "SIGNALING_SECRET is not set: any client may join any room without a room token",
    );
  }

  return {
    stop() {
      wss.close();
    },
  };
}

function relay(
  rooms: Map<string, Room>,
  ws: WebSocket,
  message: WebRtcMessage,
) {
  if (!rooms.has(message.room)) {
    rooms.set(message.room, new Map());
  }

  const currentRoom = rooms.get(message.room);

  if (!currentRoom) {
    throw new Error("Room not found");
  }

  if ("from" in message && !currentRoom.get(message.from)) {
    currentRoom.set(message.from, { ws, userId: message.from });
  }

  // Relay message to other clients in the same room
  if (message.type === "join" || message.type === "leave") {
    for (const [clientId, client] of currentRoom) {
      if (clientId !== message.from) {
        switch (message.type) {
          case "leave":
            currentRoom.delete(message.from);
            client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
            break;
          case "join":
            client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
            break;
          default:
            throw new Error("Unknown message type", message satisfies never);
        }
      }
    }
  }
  // Relay message to specific user
  if (
    message.type === "offer" ||
    message.type === "answer" ||
    message.type === "iceCandidate"
  ) {
    for (const [clientId, client] of currentRoom) {
      if (clientId === message.to) {
        client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
      }
    }
  }
}
