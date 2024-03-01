import { WebSocketServer, type WebSocket } from 'ws'
import type { WebRtcMessage } from "@packages/types"


type Client = {
  ws: WebSocket;
  userId: string;
};

type Room = Map<string, Client>;

const wss = new WebSocketServer({ port: 8080 });

const rooms = new Map<string, Room>();

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (msg: string) => {
    console.log('received: %s', msg);
    const message = JSON.parse(msg) as WebRtcMessage;

    if (!rooms.has(message.room)) {
      rooms.set(message.room, new Map());
    }

    const currentRoom = rooms.get(message.room);

    switch (message.action) {
      case 'join':
        if (currentRoom) {
          currentRoom.set(message.userId, { ws, userId: message.userId });
          console.log('currentRoom.size', currentRoom.size);
          // Check if the participant is the first or second to join the room
          if (currentRoom.size === 2) {
            // Notify the first participant to create an offer
            const [firstUserId] = currentRoom.keys();
            if (!firstUserId) return;
            const firstUserClient = currentRoom.get(firstUserId);
            firstUserClient?.ws.send(JSON.stringify({
              action: 'send',
              room: message.room,
              userId: firstUserId,
              type: 'initiateOffer'
            } satisfies WebRtcMessage));
          }
        }
        break;
      case 'leave':
        // Remove client from room
        if (currentRoom) currentRoom.delete(message.userId);
        break;
      case 'send':
        break;
      default:
        throw new Error('Unknown action:', message satisfies never);
    }

    // Relay message to other clients in the same room
    if (message.type && currentRoom) {
      currentRoom.forEach((client, clientId) => {
        if (clientId !== message.userId) {
          switch (message.type) {
            case 'offer':
              client.ws.send(JSON.stringify({ ...message, userId: clientId, offer: message.offer }));
              break;
            case 'answer':
              client.ws.send(JSON.stringify({ ...message, userId: clientId, answer: message.answer }));
              break;
            case 'iceCandidate':
              client.ws.send(JSON.stringify({ ...message, userId: clientId, candidate: message.candidate }));
              break;
            case 'initiateOffer':
            case 'connection':
              console.log(`should not relay ${message.type} message`);
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
        }
      });
      if (room.size === 0) {
        rooms.delete(roomId); // Clean up empty rooms
      }
    });
  });
});



console.log('WebSocket server started on ws://localhost:8080');
