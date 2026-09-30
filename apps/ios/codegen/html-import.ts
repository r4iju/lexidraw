import { $generateNodesFromDOM } from "@lexical/html";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import { exportNode } from "../reference/export-node";
import { NativeDOMNode, type DOMData } from "./html-dom";

Object.assign(globalThis, {
  importClipboardDOM(data: string) {
    const dom = NativeDOMNode.create(JSON.parse(data) as DOMData);
    const editor = createHeadlessEditor({
      nodes: SCHEMA_NODES,
      onError(error) {
        throw error;
      },
    });
    let output = "";
    editor.update(
      () => {
        output = JSON.stringify(
          $generateNodesFromDOM(
            editor,
            dom as unknown as Parameters<typeof $generateNodesFromDOM>[1],
          ).map(exportNode),
        );
      },
      { discrete: true },
    );
    return output;
  },
});
