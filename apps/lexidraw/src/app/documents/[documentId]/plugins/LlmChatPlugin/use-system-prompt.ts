import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRuntimeSpec } from "./reflect-editor-runtime";
import {
  $getRoot,
  $isElementNode,
  type LexicalNode,
  type EditorState,
} from "lexical";
import { useRuntimeTools } from "./runtime-tools-provider";

/**
 * returns a system prompt tailored to the current operational mode.
 *
 * ─ chat mode  ────────────────────────────────────────────────────────────
 *   • plain‑language Q&A, no tool usage.
 *
 * ─ agent mode ────────────────────────────────────────────────────────────
 *   • uses runtime tools to mutate the document.
 *   • filters tools to those relevant to the current node set.
 *
 * ─ slide agent mode ────────────────────────────────────────────────────
 *  • orchestrates a multi-step slide generation workflow.
 *  • may use specialized tools for research, media generation, etc.
 */
export function useSystemPrompt(
  mode: "chat" | "agent" | "debug" | "slide-agent",
) {
  const [editor] = useLexicalComposerContext();
  const tools = useRuntimeTools();
  const { runtimeSpec } = useRuntimeSpec();

  /* -------------------------------------------------------------- */
  /* 🗺️  track node types currently present in the document        */
  /* -------------------------------------------------------------- */
  const [existingNodeTypes, setExistingNodeTypes] = useState(
    () => new Set<string>(),
  );

  const collectTypesRef = useRef<(node: LexicalNode, set: Set<string>) => void>(
    () => {
      // Initial placeholder function
    },
  );

  const collectTypes = useCallback((node: LexicalNode, set: Set<string>) => {
    if (!$isElementNode(node)) return;
    set.add(node.getType());
    for (const child of node.getChildren()) {
      collectTypesRef.current(child, set);
    }
  }, []);

  useEffect(() => {
    collectTypesRef.current = collectTypes;
  }, [collectTypes]);

  useEffect(() => {
    const computeNodeTypes = (state: EditorState) => {
      const next = new Set<string>();
      state.read(() => {
        for (const n of $getRoot().getChildren()) {
          collectTypes(n, next);
        }
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
  /* 📝 build prompt                                                */
  /* -------------------------------------------------------------- */
  return useMemo(() => {
    const nodeLines = runtimeSpec.nodes
      .map((n) => `• ${n.type}${n.isInline ? " (inline)" : ""}`)
      .join("\n");

    // ────────────────────────────────────────────────────────────────
    // chat mode prompt
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
    // debug mode prompt (new)
    // ────────────────────────────────────────────────────────────────
    if (mode === "debug") {
      return (
        `You are in **Debug Mode**.\n\n` +
        `This mode is for testing individual tools. Interaction is through the UI elements.
` +
        `No direct chat interaction is expected in this mode.`
      ).trim();
    }

    // ────────────────────────────────────────────────────────────────
    // slide agent mode prompt
    // ────────────────────────────────────────────────────────────────
    if (mode === "slide-agent") {
      // the system prompt for individual steps within the slide-agent workflow
      // will be defined within useSlideCreationWorkflow.ts for each step's specific agent.
      // this top-level system prompt for the "slide-agent" mode itself might be more general,
      // or explain that it's in a workflow state if general chat is also allowed here.
      return (
        `You are currently in **Slide Agent Mode**.\n\n` +
        `This mode is dedicated to a multi-step process for generating slide presentations.
` +
        `User interactions in this mode will typically initiate or provide input to this workflow.
` +
        `Follow the instructions from the workflow orchestrator.
` +
        `If a user provides general chat outside the workflow, respond concisely and guide them back to the slide generation task or suggest switching modes.`
      ).trim();
    }

    // filter tools to only those relevant to the current document.
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
    // agent mode prompt
    // ────────────────────────────────────────────────────────────────
    return (
      `You are a document‑editing assistant in **Agent Mode**.\n\n` +
      `### Available node types\n${nodeLines}\n\n` +
      `### Available tools\n${toolLines}\n\n` +
      `### Interaction Guidelines\n` +
      `1. If the request is ambiguous or multi‑step, use **requestClarificationOrPlan**.\n` +
      `2. Call mutation tools with **only** the JSON payload.\n` +
      `3. After all modifications, finish with **summarizeAfterToolCallExecution**.\n` +
      `4. Use **sendReply** only when it's clear the user is not requesting document modification, but rather a response to the chat.`
    ).trim();
  }, [mode, runtimeSpec, tools, existingNodeTypes]);
}
