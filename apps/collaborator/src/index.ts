import { WebSocketServer, WebSocket } from 'ws'

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
    // Broadcast incoming message to all clients except the sender
    wss.clients.forEach(function each(client) {
      try {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      } catch (e) {
        console.error('Error:', e);
      }
    });
  });

  ws.on('close', function close() {
    console.log('Client disconnected');
  });
});

console.log('WebSocket server started on port 8080');
