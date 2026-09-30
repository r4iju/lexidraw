import { withDOM } from "@lexical/headless/dom";
import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import { exportNode } from "./export-node.js";

type DOMWindow = Parameters<Parameters<typeof withDOM>[0]>[0];
function withClipboardDOM<T>(run: (window: DOMWindow) => T): T {
  return withDOM((window) => {
    // withDOM omits this browser global, which stylesheet import reads.
    const globals = globalThis as typeof globalThis & {
      CSSStyleRule?: unknown;
    };
    const previousRule = globals.CSSStyleRule;
    globals.CSSStyleRule = (
      window as unknown as { CSSStyleRule: typeof globals.CSSStyleRule }
    ).CSSStyleRule;
    try {
      return run(window);
    } finally {
      globals.CSSStyleRule = previousRule;
    }
  });
}
function createEditor() {
  return createHeadlessEditor({
    nodes: SCHEMA_NODES,
    onError(error) {
      throw error;
    },
  });
}
export function htmlOracle(html: string) {
  return withClipboardDOM((window) => {
    const editor = createEditor();
    let output: unknown[] = [];
    editor.update(
      () => {
        const dom = new window.DOMParser().parseFromString(html, "text/html");
        output = $generateNodesFromDOM(editor, dom).map(exportNode);
      },
      { discrete: true },
    );
    return output;
  });
}
export function htmlForDocument(json: unknown): string {
  return withClipboardDOM(() => {
    const editor = createEditor();
    editor.setEditorState(editor.parseEditorState(JSON.stringify(json)));
    return editor
      .getEditorState()
      .read(() => $generateHtmlFromNodes(editor, null));
  });
}
