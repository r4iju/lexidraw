import { WebSocketServer, type WebSocket } from 'ws'
import type { WebRtcMessage } from "@packages/types"


type Client = {
  ws: WebSocket;
  userId: string;
};

type Room = Map<string, Client>;

export function startServer(port = 8080) {
  const wss = new WebSocketServer({ port });

  const rooms = new Map<string, Room>();

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (msg: string) => {
      const message = JSON.parse(msg) as WebRtcMessage;
      console.log('received: ', message);

      if (!rooms.has(message.room)) {
        rooms.set(message.room, new Map());
      }

      const currentRoom = rooms.get(message.room);

      if ('userId' in message && !currentRoom?.get(message.userId)) {
        currentRoom?.set(message.userId, { ws, userId: message.userId });
      }

      // Relay message to other clients in the same room
      if ('userId' in message && currentRoom) {
        currentRoom.forEach((client, clientId) => {
          if (clientId !== message.userId) {
            switch (message.type) {
              case 'offer':
              case 'answer':
              case 'iceCandidate':
                client.ws.send(JSON.stringify(message));
                break;
              case 'leave':
                if (currentRoom) currentRoom.delete(message.userId);
                client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
                break;
              case 'join':
                client.ws.send(JSON.stringify(message satisfies WebRtcMessage));
                break;
              default:
                throw new Error('Unknown message type', message satisfies never);
            }
          }
        });
      }
    });

    ws.on('close', () => {
      // Remove the client from all rooms
      rooms.forEach((room, roomId) => {
        room.forEach((client, clientId) => {
          if (client.ws === ws) {
            room.delete(clientId);
            // also notify all peers
            room.forEach((peer) => {
              peer.ws.send(JSON.stringify({
                room: roomId,
                userId: clientId,
                type: 'leave'
              } satisfies WebRtcMessage));
            });
          }
        });
        if (room.size === 0) {
          rooms.delete(roomId); // Clean up empty rooms
        }
      });
    });
  });

  console.log(`WebSocket server started on ws://localhost:${port}`);

  return {
    stop() {
      wss.close();
    },
  };
}

