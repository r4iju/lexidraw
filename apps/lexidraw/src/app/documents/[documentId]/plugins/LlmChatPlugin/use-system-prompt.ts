import { buildRuntimeTools } from "./tool-factory";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useChatDispatch } from "./llm-chat-context";
import { useMemo } from "react";
import { makeRuntimeSpec } from "./reflect-editor-runtime";
import { $getNodeByKey } from "lexical";

export function useSystemPrompt(base: string) {
  const [editor] = useLexicalComposerContext();
  const dispatch = useChatDispatch();

  return useMemo(() => {
    const spec = makeRuntimeSpec(editor);
    const allTools = buildRuntimeTools({ editor, dispatch });
    const allToolNames = Object.keys(allTools);

    const editorState = editor.getEditorState();
    const existingNodeTypes = new Set<string>();
    editorState.read(() => {
      const nodeMap = editorState._nodeMap;
      for (const key of nodeMap.keys()) {
        const node = $getNodeByKey(key);
        if (node) {
          existingNodeTypes.add(node.getType());
        }
      }
    });

    const filteredToolNames = allToolNames.filter((toolName) => {
      if (toolName.startsWith("set")) {
        const parts = toolName.split("-");
        if (parts.length > 1 && parts[0]) {
          const nodeType = parts[0].substring(3);
          return existingNodeTypes.has(nodeType);
        }
      }
      return true;
    });

    const nodeLines = spec.nodes
      .map((n) => `• ${n.type}${n.isInline ? " (inline)" : ""}`)
      .join("\n");

    const toolLines = filteredToolNames.map((t) => `• ${t}`).join("\n");

    return `${base}

### Available node types
${nodeLines}

### Available tools
${toolLines}

### Interaction Guidelines
1.  **Perspective:** Always explain plans and actions in the first person (e.g., 'I will...').
2.  **Clarity First:** If the request is ambiguous, lacks detail, or has multiple interpretations, ask clarifying questions using 'requestClarificationOrPlan' before acting. Do not guess.
3.  **Mutation Response:** When calling a tool that mutates the document (like 'updateDocumentSemantically' or 'setX-Y' tools), respond ONLY with the tool call JSON.
4.  **Confirmation:** After ANY tool executes successfully, respond with a brief confirmation message summarizing the action taken.
5.  **Final Summary:** After completing all requested actions, you MUST conclude by calling 'summarizeExecution' with a 'summaryText' describing all steps taken.

### Tool Specific Notes
*   **setX-Y Tools:** 'anchorKey' must reference a node of type X.
*   **requestClarificationOrPlan:** Use 'operation': "plan" with 'objective' text, or 'operation': "clarify" with 'clarification' text.
*   **updateDocumentSemantically:**
    *   Instructions MUST have a top-level 'operation' field ('formatBlock', 'insertBlock', 'deleteBlock') and a flat structure.
    *   Use 'anchorKey' (preferred) or 'anchorText'. Provide exactly one anchor per instruction.
    *   For 'insertBlock', 'relation' must be one of: 'before', 'after', 'appendRoot'.
    *   To insert list items, use 'operation': "insertBlock" with 'blockType': "list" and specify the 'listType' ('bullet', 'number', 'check'). The tool automatically creates the list item node.
    *   Use 'formatBlock' to replace content or reformat existing blocks (e.g., paragraph to heading).
    *   To delete images, use 'deleteBlock' with the image node's 'anchorKey'.
*   **imageGenerationTool:** Provide a detailed 'prompt' including style, subject, environment, etc.
*   **searchAndInsertImageTool:** Requires a 'query' parameter for the image search.

### Example Instructions
*   \`setheading-Tag\`: \`anchorKey\` must reference a \`heading\` node. Error Example: "❌ [setheading-Tag] Error: Anchor resolves to paragraph, but setheading-Tag can only edit heading."
*   \`updateDocumentSemantically\` (Insert Example): \`{ "operation": "insertBlock", "blockType": "heading", "text": "My New Heading", "headingTag": "h2", "relation": "appendRoot" }\`
*   \`updateDocumentSemantically\` (Format Example): \`{ "operation": "formatBlock", "anchorKey": "123", "formatAs": "heading", "headingTag": "h1" }\`
*   \`updateDocumentSemantically\` (List Item Insert Example): \`{ "operation": "insertBlock", "blockType": "list", "listType": "bullet", "text": "New item", "relation": "after", "anchorKey": "listItem456" }\`
`.trim();
  }, [base, editor, dispatch]);
}
