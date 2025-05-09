import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMakeRuntimeSpec } from "./reflect-editor-runtime";
import { $getRoot, $isElementNode, LexicalNode, EditorState } from "lexical";
import { useRuntimeTools } from "./runtime-tools-provider";

export function useSystemPrompt(base: string, mode: "chat" | "agent") {
  const [editor] = useLexicalComposerContext();
  const tools = useRuntimeTools();

  const [existingNodeTypes, setExistingNodeTypes] = useState(
    () => new Set<string>(),
  );

  const collectTypes = useCallback((node: LexicalNode, types: Set<string>) => {
    if (!$isElementNode(node)) return;
    types.add(node.getType());
    node.getChildren().forEach((child) => collectTypes(child, types));
  }, []);

  useEffect(() => {
    const calculateNodeTypes = (editorState: EditorState) => {
      const types = new Set<string>();
      editorState.read(() => {
        $getRoot()
          .getChildren()
          .forEach((node) => collectTypes(node, types));
      });
      setExistingNodeTypes((prevTypes) => {
        if (
          prevTypes.size === types.size &&
          [...prevTypes].every((type) => types.has(type))
        ) {
          return prevTypes;
        }
        return types;
      });
    };

    calculateNodeTypes(editor.getEditorState());

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      calculateNodeTypes(editorState);
    });

    return () => {
      unregister();
    };
  }, [collectTypes, editor]);

  const { makeRuntimeSpec } = useMakeRuntimeSpec();

  return useMemo(() => {
    console.log(
      "🔄 Recalculating system prompt with node types:",
      existingNodeTypes,
    );
    const spec = makeRuntimeSpec();

    const filteredTools = Object.keys(tools).filter((toolName) => {
      if (toolName.startsWith("set")) {
        const nodeType = toolName.split("-")?.[0]?.slice(3);
        return nodeType && existingNodeTypes.has(nodeType);
      }
      return true;
    });

    const nodeLines = spec.nodes
      .map((n) => `• ${n.type}${n.isInline ? " (inline)" : ""}`)
      .join("\n");

    const toolLines =
      mode === "chat"
        ? "• No tools available – respond directly in Markdown."
        : filteredTools.map((t) => `• ${t}`).join("\n");

    return `${base}\n\n            **Operational Modes:**\n            - **Chat Mode:** For general conversation, questions, or non-document tasks. **Do not** emit JSON or tool calls – just answer in plain Markdown. Document context is provided as **Markdown**.\n            - **Agent Mode:** For tasks involving document modification (inserting, formatting, moving, etc.). All tools **except** \`sendReply\` are available. Document context is provided as **JSON**.\n\n            ### Available node types\n            ${nodeLines}\n\n            ### Available tools\n            ${toolLines}\n\n            ### Interaction Guidelines\n            1.  **Clarity First:** If the user's request *for document modification* is unclear, ambiguous, or requires multiple steps, **use 'requestClarificationOrPlan'** before acting (Agent Mode). Use \`operation: "plan"\` to outline steps or \`operation: "clarify"\` to ask questions.
            2.  **Mutation Response:** When calling a tool that mutates the document respond **only** with the tool call JSON. A plaintext answer is accepted.
            3.  **Confirmation / Final Summary:** After completing all requested *document modification actions* in Agent Mode, **you must** conclude by calling \`summarizeExecution\` with a \`summaryText\` describing all steps taken.
            4.  **Mode Awareness:** 
                - In **Chat Mode**, respond directly in **Markdown**. **Do not** use tools or output JSON. Document context is **Markdown**.
                - In **Agent Mode**: Document context is **JSON**.
                    - Your primary goal is to modify the document using tools.
                    - Use \`sendReply\` **sparingly**, only when the user's query is clearly a direct question not related to document content/modification, an external information request, or a purely conversational comment.
                    - If a query might involve document changes, however subtle, **do not** use \`sendReply\`. Instead, use \`requestClarificationOrPlan\` or the appropriate modification tool.
                    - For requests involving document changes, assess clarity (Guideline 1), then act with tools.
                    - Conclude document modification sequences with \`summarizeExecution\`.

            ### Tool Specific Notes
            - **setX-Y Tools:** \`anchorKey\` must reference a node of type X. e.g., for \`setListItem-Checked\`, if the \`anchorKey\` (or resolved \`anchorText\`) points to a \`ParagraphNode\` instead of a \`ListItemNode\`, it will fail with an error like: "❌ [setListItem-Checked] Error: Anchor resolves to paragraph, but setListItem-Checked can only edit listitem."
            - **requestClarificationOrPlan:** Use this **in Agent Mode** when the user's goal for *document modification* is unclear, ambiguous, or requires multiple steps. Use \`operation: "plan"\` to outline your intended actions or \`operation: "clarify"\` to ask for more details *before* modifying the document.
            - **insertTextNode:** Use \`relation\` of \`"before"\`, \`"after"\` or \`"appendRoot"\`
            - **imageGenerationTool:** Provide a detailed \`prompt\` (style, subject, environment, etc.).
            - **searchAndInsertImageTool:** Requires a \`query\` parameter for the image search.
            - **insertListItemNode:** IMPORTANT: \`anchor\` must be the KEY of an existing \`ListNode\` for \`appendToList\`, OR the KEY of an existing \`ListItemNode\` for \`before\`/\`after\`
            - **Creating/Adding to Lists:** To start a new list, use \`insertListNode\`. This creates the list and the first item. To add more items, use \`insertListItemNode\`, anchoring to the \`ListNode\` (using its key and \`appendToList\`) or the *last* \`ListItemNode\` (using its key and \`after\`).
            - **removeNode:** Requires the \`nodeKey\` of the node to be removed.
            - **moveNode:** Requires the \`nodeKey\` of the node to move, the \`anchorKey\` of the node to move relative to, and a \`relation\` (\`"before"\` or \`"after"\`). Both nodes must be siblings (have the same parent).
            - **applyTextStyle:** Used to change the font, size, color, etc., of specific text. \`anchorKey\` MUST be the key of a \`TextNode\`. Provide CSS style values (e.g., \`fontFamily: 'Times New Roman'\`, \`fontSize: '16px'\`, \`color: '#0000FF'\`). To remove a style property (e.g., remove custom font), pass an empty string \`''\` as its value.
            - **Positioning New Content (General Rule for Insertion Tools like insertTextNode, insertExcalidrawNode, etc.):**
                - The \`relation\` parameter determines placement and can be \`"before"\` or \`"after"\` or \`"appendRoot"\`.\n                - If \`relation\` is omitted, it **defaults to \`"appendRoot"\`**. You should rely on this default if you want to append to the end of the document. **Do not explicitly send \`relation: undefined\`**.\n                - If \`relation\` is \`"before"\` or \`"after"\` or \`"appendRoot"\` (or defaulted to it), the \`anchor\` parameter is **required**.\n                - If \`relation\` is \`"appendRoot"\` (or defaulted to it), the \`anchor\` parameter is ignored.
            - **combinedTools:** Executes multiple tool calls sequentially in a single step. Provide a \`calls\` array, where each element is an object \`{ toolName: string, args: object }\` specifying the tool and its arguments. Execution stops if any sub-call fails. This is favored for batching operations. You absolutely must use this tool if you need to perform multiple operations in a single step.
            - **sendReply:**
                - In **Chat Mode**: This is your primary response tool for direct text replies.
                - In **Agent Mode**: Use this **sparingly**. Only for direct questions not involving document state/modification, external info requests, or purely conversational remarks. If unsure, prefer action tools or \`requestClarificationOrPlan\`.
                Requires \`replyText\`.
            `
      .replaceAll("            ", "")
      .trim();
  }, [existingNodeTypes, makeRuntimeSpec, tools, mode, base]);
}
