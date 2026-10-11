"use client";
import {
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  useEffect,
} from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM } from "../../context/llm-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useMarkdownTools } from "../../utils/markdown";
import { generateUUID } from "~/lib/utils";
import { useAgentWorkflow } from "./use-agent-workflow";
import {
  CHAT_CAPABILITY,
  prepareChat,
  prepareChatSelection,
  type ChatInput,
  type ChatSelection,
} from "~/lib/generation/chat";
import {
  browserByok,
  browserByokAccount,
  browserByokSessionGeneration,
  useBrowserByok,
} from "~/lib/byok/browser-session";
import { useEntityId } from "~/hooks/use-entity-id";
interface SendQueryParams {
  prompt: string;
  selectedInput?: ChatInput;
  editorStateJson?: string;
  files?: File[] | FileList | null;
}
export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, chatSource, chatCapability } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { convertEditorStateToMarkdown } = useMarkdownTools();
  const { runAgentWorkflow } = useAgentWorkflow({ onError: () => {} });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const reviewSequence = useRef(0);
  // External system: asynchronous file reviews belong to this mounted send surface.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reviewSequence.current++;
    };
  }, []);
  const documentId = useEntityId();
  const account = browserByokAccount();
  const owner = useBrowserByok(account);
  const generation = browserByokSessionGeneration();
  const credentialGeneration = useSyncExternalStore(
    owner?.subscribe ?? (() => () => {}),
    owner?.revision ?? (() => 0),
    () => 0,
  );
  const subscribeEditor = useCallback(
    (notify: () => void) => editor.registerUpdateListener(notify),
    [editor],
  );
  const editorState = useSyncExternalStore(
    subscribeEditor,
    () => editor.getEditorState(),
    () => editor.getEditorState(),
  );
  // Scope uses immutable source references and non-secret semantic values; it is never serialized.
  const scope = useMemo(
    () => ({
      messages,
      mode,
      editorState,
      documentId,
      account,
      generation,
      credentialGeneration,
      chatSource,
      chatCapability,
    }),
    [
      messages,
      mode,
      editorState,
      documentId,
      account,
      generation,
      credentialGeneration,
      chatSource,
      chatCapability,
    ],
  );
  const current = useRef(scope);
  current.current = scope;
  const isCurrent = useCallback(
    (value: object) =>
      mounted.current &&
      current.current === value &&
      editor.getEditorState() === editorState &&
      browserByokAccount() === account &&
      browserByokSessionGeneration() === generation &&
      browserByok().revision() === credentialGeneration,
    [editor, editorState, account, generation, credentialGeneration],
  );
  const reviews = useRef(
    new WeakMap<
      ChatInput,
      {
        scope: object;
        sequence: number;
        prompt: string;
        files: ChatInput["files"];
      }
    >(),
  );
  const send = useCallback(
    async ({
      prompt,
      editorStateJson,
      files,
      selectedInput,
    }: SendQueryParams) => {
      if (!mounted.current || inFlight.current || !prompt.trim()) return;
      inFlight.current = true;
      try {
        if (selectedInput && mode !== "chat") throw new Error(CHAT_CAPABILITY);
        if (mode !== "chat") {
          await runAgentWorkflow({
            prompt,
            originalPrompt: prompt,
            documentMarkdown: convertEditorStateToMarkdown(
              editor.getEditorState(),
            ),
            documentJson: editorStateJson
              ? JSON.parse(editorStateJson)
              : undefined,
            files,
          });
          return;
        }
        if (!selectedInput) throw new Error(CHAT_CAPABILITY);
        const reviewed = reviews.current.get(selectedInput);
        if (!reviewed) throw new Error(CHAT_CAPABILITY);
        // Guard the CURRENT full candidate before trusting any omitted/excerpted wire.
        browserByok().assertSafe(
          JSON.stringify({
            prompt: reviewed.prompt,
            messages,
            context: convertEditorStateToMarkdown(editor.getEditorState()),
            files: reviewed.files,
          }),
        );
        if (
          !isCurrent(reviewed.scope) ||
          reviewed.sequence !== reviewSequence.current
        )
          throw new Error(CHAT_CAPABILITY);
        reviewSequence.current++;
        browserByok().assertSafe(JSON.stringify(prepareChat(selectedInput)));
        const attachments = selectedInput.files ?? [];
        dispatch({
          type: "push",
          msg: {
            id: generateUUID(),
            role: "user",
            content:
              selectedInput.prompt +
              attachments
                .map((file) => `\n\nAttachment ${file.name}:\n${file.text}`)
                .join(""),
          },
        });
        const id = generateUUID();
        let partial = "";
        dispatch({ type: "push", msg: { id, role: "assistant", content: "" } });
        dispatch({ type: "startStreaming", id });
        await generateChatStream({
          prompt: selectedInput.prompt,
          selectedInput,
          callbacks: {
            onTextUpdate(text) {
              partial = text;
              dispatch({ type: "update", msg: { id, content: text } });
            },
            onFinish({ text }) {
              dispatch({ type: "update", msg: { id, content: text } });
            },
            onError(error) {
              dispatch({
                type: "update",
                msg: {
                  id,
                  content: partial + (partial ? "\n\n" : "") + error.message,
                },
              });
            },
          },
        });
      } catch (error) {
        dispatch({
          type: "push",
          msg: {
            id: generateUUID(),
            role: "assistant",
            content:
              error instanceof Error && error.message === CHAT_CAPABILITY
                ? CHAT_CAPABILITY
                : "Chat could not start. Saved history is preserved.",
          },
        });
      } finally {
        inFlight.current = false;
        dispatch({ type: "stopStreaming" });
      }
    },
    [
      dispatch,
      mode,
      generateChatStream,
      runAgentWorkflow,
      convertEditorStateToMarkdown,
      editor,
      messages,
      isCurrent,
    ],
  );
  return Object.assign(send, {
    scope,
    invalidateReview() {
      reviewSequence.current++;
    },
    async review({
      prompt,
      files,
      selection,
    }: SendQueryParams & { selection: ChatSelection }) {
      const captured = scope;
      const sequence = ++reviewSequence.current;
      const attachments = await Promise.all(
        Array.from(files ?? []).map(async (file) => {
          if (
            !["text/plain", "text/markdown"].includes(file.type) ||
            file.size > 1500
          )
            throw new Error(CHAT_CAPABILITY);
          return { name: file.name, type: file.type, text: await file.text() };
        }),
      );
      if (!isCurrent(captured) || sequence !== reviewSequence.current)
        return { kind: "needs_selection" as const, message: CHAT_CAPABILITY };
      const result = prepareChatSelection(
        {
          prompt,
          messages,
          context: convertEditorStateToMarkdown(editor.getEditorState()),
          files: attachments,
        },
        selection,
        browserByok().assertSafe,
      );
      if (result.kind === "ready") {
        for (const message of result.input.messages) Object.freeze(message);
        for (const file of result.input.files) Object.freeze(file);
        Object.freeze(result.input.messages);
        Object.freeze(result.input.files);
        Object.freeze(result.input);
        reviews.current.set(result.input, {
          scope: captured,
          sequence,
          prompt,
          files: result.input.files,
        });
      }
      return result;
    },
  });
};
