import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRuntimeSpec } from "./reflect-editor-runtime";
import { $getRoot, $isElementNode, LexicalNode, EditorState } from "lexical";
import { useRuntimeTools } from "./runtime-tools-provider";

/**
 * Returns a system prompt tailored to the current operational mode.
 *
 * ─ Chat Mode  ────────────────────────────────────────────────────────────
 *   • Plain‑language Q&A, no tool usage.
 *
 * ─ Agent Mode ────────────────────────────────────────────────────────────
 *   • Uses runtime tools to mutate the document.
 *   • Filters tools to those relevant to the current node set.
 */
export function useSystemPrompt(mode: "chat" | "agent" | "debug") {
  const [editor] = useLexicalComposerContext();
  const tools = useRuntimeTools();
  const { runtimeSpec } = useRuntimeSpec();

  /* -------------------------------------------------------------- */
  /* 🗺️  Track node types currently present in the document        */
  /* -------------------------------------------------------------- */
  const [existingNodeTypes, setExistingNodeTypes] = useState(
    () => new Set<string>(),
  );

  const collectTypes = useCallback((node: LexicalNode, set: Set<string>) => {
    if (!$isElementNode(node)) return;
    set.add(node.getType());
    node.getChildren().forEach((child) => collectTypes(child, set));
  }, []);

  useEffect(() => {
    const computeNodeTypes = (state: EditorState) => {
      const next = new Set<string>();
      state.read(() => {
        $getRoot()
          .getChildren()
          .forEach((n) => collectTypes(n, next));
      });
      setExistingNodeTypes((prev) =>
        prev.size === next.size && [...prev].every((t) => next.has(t))
          ? prev
          : next,
      );
    };

    computeNodeTypes(editor.getEditorState());
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      computeNodeTypes(editorState);
    });
    return unregister;
  }, [editor, collectTypes]);

  /* -------------------------------------------------------------- */
  /* 📝 Build prompt                                                */
  /* -------------------------------------------------------------- */
  return useMemo(() => {
    const nodeLines = runtimeSpec.nodes
      .map((n) => `• ${n.type}${n.isInline ? " (inline)" : ""}`)
      .join("\n");

    // ────────────────────────────────────────────────────────────────
    // Chat Mode prompt
    // ────────────────────────────────────────────────────────────────
    if (mode === "chat") {
      return (
        `You are a helpful assistant in **Chat Mode**.\n\n` +
        `### Available node types\n${nodeLines}\n\n` +
        `### Interaction Guidelines\n` +
        `- Respond directly in **Markdown**.\n` +
        `- **Do not** emit JSON or call any tools.`
      ).trim();
    }

    // ────────────────────────────────────────────────────────────────
    // Debug Mode prompt (New)
    // ────────────────────────────────────────────────────────────────
    if (mode === "debug") {
      return (
        `You are in **Debug Mode**.\n\n` +
        `This mode is for testing individual tools. Interaction is through the UI elements.
` +
        `No direct chat interaction is expected in this mode.`
      ).trim();
    }

    // Filter tools to only those relevant to the current document.
    const filtered = Object.keys(tools).filter((name) => {
      if (!name.startsWith("set")) return true;
      const node = name.split("-")[0]?.slice(3);
      return node && existingNodeTypes.has(node);
    });

    const toolLines =
      filtered.length === 0
        ? "• No tools available."
        : filtered.map((t) => `• ${t}`).join("\n");

    // ────────────────────────────────────────────────────────────────
    // Agent Mode prompt
    // ────────────────────────────────────────────────────────────────
    return (
      `You are a document‑editing assistant in **Agent Mode**.\n\n` +
      `### Available node types\n${nodeLines}\n\n` +
      `### Available tools\n${toolLines}\n\n` +
      `### Interaction Guidelines\n` +
      `1. If the request is ambiguous or multi‑step, use **requestClarificationOrPlan**.\n` +
      `2. Call mutation tools with **only** the JSON payload.\n` +
      `3. After all modifications, finish with **summarizeExecution**.\n` +
      `4. Use **sendReply** only when it's clear the user is not requesting document modification, but rather a response to the chat.`
    ).trim();
  }, [mode, runtimeSpec, tools, existingNodeTypes]);
}
