import { WebSocketServer, WebSocket } from 'ws'
import { MessageStructure } from "@packages/types"
import { drizzle, eq, schema } from "@packages/drizzle"
import { debounce } from "@packages/lib"

const wss = new WebSocketServer({ port: 8080 });

const clientDrawingMap = new Map<WebSocket, string>();

const debouncedSave = debounce(async (
  drawingId: string,
  elements: MessageStructure['payload']['elements'],
  appState: MessageStructure['payload']['appState']
) => {
  console.log('debouncedSave');

  await drizzle.update(schema.drawing)
    .set({
      elements: JSON.stringify(elements),
      appState: JSON.stringify(appState),
    })
    .where(eq(schema.drawing.id, drawingId))
    .execute();
}, 1000);

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received message');
    try {
      console.log('typeof message: ', typeof message)
      const parsedMessage = JSON.parse(message.toString()) as MessageStructure;
      const { drawingId } = parsedMessage;
      console.log('drawingId: ', drawingId)

      // save to db
      debouncedSave(drawingId, parsedMessage.payload.elements, parsedMessage.payload.appState)

      // Update client's associated drawingId
      clientDrawingMap.set(ws, drawingId);

      // Broadcast incoming message to all clients with the same drawingId, except the sender
      wss.clients.forEach(function each(client) {
        if (client !== ws && client.readyState === WebSocket.OPEN && clientDrawingMap.get(client) === drawingId) {
          client.send(message);
        }
      });
    } catch (e) {
      console.error('Error:', e);
    }
  });

  ws.on('close', function close() {
    // Remove the client from the map when they disconnect
    clientDrawingMap.delete(ws);
    console.log('Client disconnected');
  });
});


console.log('WebSocket server started on port 8080');
