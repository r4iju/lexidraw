/**
 * A host, as far as the widget can tell: the page the browser test loads.
 *
 * It is the MCP Apps host half of the SDK — `AppBridge` over
 * `PostMessageTransport` — driving a real iframe, so the handshake, the
 * tool-result notification, and the tool calls coming back are the protocol
 * itself and not a re-implementation of it. The bridge is built with no MCP
 * client, which is the SDK's own way of saying the host answers tool calls
 * itself; `oncalltool` below stands in for the server and records what the
 * widget asked for.
 */
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

type Call = { name: string; arguments?: Record<string, unknown> };

declare global {
  interface Window {
    host: {
      initialized: boolean;
      calls: Call[];
      drawing: { updatedAt: string; elements: unknown[] } | null;
      /** What the widget told the model about the user's edits. */
      context: string[];
      /** What the host sends when a drawing tool answers. */
      deliver: (result: Record<string, unknown>) => Promise<void>;
    };
  }
}

const state: Window["host"] = {
  initialized: false,
  calls: [],
  drawing: null,
  context: [],
  deliver: async () => {},
};
window.host = state;

const iframe = document.createElement("iframe");
iframe.id = "app";
iframe.style.cssText = "width:100%;height:600px;border:0";
document.body.appendChild(iframe);

const bridge = new AppBridge(
  null,
  { name: "test-host", version: "1.0.0" },
  { serverTools: {}, updateModelContext: {} },
);

bridge.addEventListener("initialized", () => {
  state.initialized = true;
});

bridge.oncalltool = async (params) => {
  state.calls.push({
    name: params.name,
    arguments: params.arguments as Record<string, unknown>,
  });
  if (params.name === "put_drawing") {
    const elements = (params.arguments?.elements ?? []) as unknown[];
    const updatedAt = new Date().toISOString();
    state.drawing = { updatedAt, elements };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: params.arguments?.id,
            updatedAt,
            elementCount: elements.length,
          }),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          message: `This host answers put_drawing and nothing else; ${params.name} was asked for.`,
          code: "NOT_IMPLEMENTED",
        }),
      },
    ],
  };
};

bridge.onupdatemodelcontext = async (params) => {
  for (const block of params.content ?? []) {
    if (block.type === "text") state.context.push(block.text);
  }
  return {};
};

state.deliver = (result) => bridge.sendToolResult(result as never);

// The listener has to be on the parent before the document that talks to it
// loads, so the frame is attached empty and navigated afterwards; a same-origin
// navigation keeps the window the transport validates against.
const target = iframe.contentWindow;
if (!target) throw new Error("the frame has no window");
await bridge.connect(new PostMessageTransport(target, target));
iframe.src = "/widget";
