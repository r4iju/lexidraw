/// <reference types="bun" />
/**
 * Who pays for the preview payload.
 *
 * MCP Apps is a negotiated client capability, so a client that renders nothing
 * can be told apart from a host that does — and the drawing a write reads back
 * for the widget is charged only to the second. The route's tests cover what
 * the payload then contains; these cover whether it is built at all.
 */
import { expect, test } from "bun:test";
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  loadDrawingPreviewMeta,
  readPreviewMeta,
  wantsPreview,
} from "./widget";
import type { RouterCaller } from "./tools";

const APP_CLIENT = {
  extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
};

/** A server whose client said what it can do, as a stateful session would. */
function serverFor(capabilities: unknown): McpServer {
  return {
    server: { getClientCapabilities: () => capabilities },
  } as unknown as McpServer;
}

/** A caller that fails the test if a tool reads anything through it. */
function untouchedCaller(): RouterCaller {
  return {
    auth: {
      me: () => {
        throw new Error("the scope was read for a client with no widget");
      },
    },
    drawings: {
      get: () => {
        throw new Error("the drawing was read for a client with no widget");
      },
    },
  } as unknown as RouterCaller;
}

const drawing = {
  id: "draw_1",
  title: "Boxes",
  updatedAt: "2026-09-23T10:00:00.000Z",
  elements: [{ id: "one", type: "rectangle" }],
};

function callerFor(scope: "read" | "write"): RouterCaller {
  return {
    auth: { me: async () => ({ scope }) },
    drawings: { get: async () => drawing },
  } as unknown as RouterCaller;
}

test("builds the payload for a client that renders MCP Apps", async () => {
  const server = serverFor(APP_CLIENT);
  await expect(
    loadDrawingPreviewMeta(server, callerFor("write"), drawing.id),
  ).resolves.toMatchObject({
    "app.lexidraw/drawing": { id: drawing.id, canWrite: true },
  });
  await expect(
    readPreviewMeta(server, callerFor("read"), drawing),
  ).resolves.toMatchObject({
    "app.lexidraw/drawing": { id: drawing.id, canWrite: false },
  });
});

test("reads nothing back for a client that cannot render one", async () => {
  // A plain MCP client gets the answer it would have got without the widget,
  // and the write costs the database exactly what it did before.
  const server = serverFor({ roots: {} });
  await expect(
    loadDrawingPreviewMeta(server, untouchedCaller(), drawing.id),
  ).resolves.toBeUndefined();
  await expect(
    readPreviewMeta(server, untouchedCaller(), drawing),
  ).resolves.toBeUndefined();
});

test("treats a client it never negotiated with as one that renders", () => {
  // This endpoint is stateless: a `tools/call` arrives on its own server, with
  // no memory of the `initialize` that named the client's capabilities. A host
  // seeing no drawing at all is the worse failure of the two.
  expect(wantsPreview(undefined)).toBe(true);
  expect(wantsPreview(null)).toBe(true);
  expect(wantsPreview(APP_CLIENT)).toBe(true);
  expect(wantsPreview({ roots: {} })).toBe(false);
});
