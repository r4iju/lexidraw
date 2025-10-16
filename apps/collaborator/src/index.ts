import { drizzle, eq, schema } from "@packages/drizzle";
import { debounce } from "@packages/lib";
import type { MessageStructure } from "@packages/types";
import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

const clientDrawingMap = new Map<WebSocket, string>();

const debouncedSave = debounce(
  async (
    drawingId: string,
    elements: MessageStructure["payload"]["elements"],
    appState: MessageStructure["payload"]["appState"],
  ) => {
    console.log("debouncedSave");

    await drizzle
      .update(schema.entities)
      .set({
        elements: JSON.stringify(elements),
        appState: JSON.stringify(appState),
      })
      .where(eq(schema.entities.id, drawingId))
      .execute();
  },
  1000,
);

wss.on("connection", function connection(ws) {
  ws.on("message", function incoming(message) {
    console.log("received message");
    try {
      console.log("typeof message: ", typeof message);
      const parsedMessage = JSON.parse(message.toString()) as MessageStructure;
      const { entityId } = parsedMessage;
      console.log("entityId: ", entityId);

      // save to db
      debouncedSave(
        entityId,
        parsedMessage.payload.elements,
        parsedMessage.payload.appState,
      );

      // Update client's associated entityId
      clientDrawingMap.set(ws, entityId);

      // Broadcast incoming message to all clients with the same entityId, except the sender
      for (const client of wss.clients) {
        if (
          client !== ws &&
          client.readyState === WebSocket.OPEN &&
          clientDrawingMap.get(client) === entityId
        ) {
          client.send(message);
        }
      }
    } catch (e) {
      console.error("Error:", e);
    }
  });

  ws.on("close", function close() {
    // Remove the client from the map when they disconnect
    clientDrawingMap.delete(ws);
    console.log("Client disconnected");
  });
});

console.log("WebSocket server started on port 8080");
