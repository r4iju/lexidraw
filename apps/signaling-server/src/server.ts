import type { WebRtcMessage } from "@packages/types";
import { type WebSocket, WebSocketServer } from "ws";

type Client = {
  ws: WebSocket;
  userId: string;
};

type Room = Map<string, Client>;

export function startServer(port = 8080) {
  const wss = new WebSocketServer({ port });

  const rooms = new Map<string, Room>();

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (msg: string) => {
      const message = JSON.parse(msg) as WebRtcMessage;
      // console.log('received: ', message);

      if (!rooms.has(message.room)) {
        rooms.set(message.room, new Map());
      }

      const currentRoom = rooms.get(message.room);

      if (!currentRoom) {
        throw new Error("Room not found");
      }

      if ("from" in message && !currentRoom.get(message.from)) {
        currentRoom?.set(message.from, { ws, userId: message.from });
      }

      // Relay message to other clients in the same room
      if (message.type === "join" || message.type === "leave") {
        for (const [clientId, client] of currentRoom) {
          if (clientId !== message.from) {
            switch (message.type) {
              case "leave":
                if (currentRoom) currentRoom.delete(message.from);
                client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
                break;
              case "join":
                client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
                break;
              default:
                throw new Error(
                  "Unknown message type",
                  message satisfies never,
                );
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
    });

    ws.on("close", () => {
      // Remove the client from all rooms
      for (const [roomId, room] of rooms) {
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
          rooms.delete(roomId); // Clean up empty rooms
        }
      }
    });
  });

  console.log(`WebSocket server started on ws://localhost:${port}`);

  return {
    stop() {
      wss.close();
    },
  };
}
