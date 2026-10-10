"use client";
import { useCallback, useRef } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM } from "../../context/llm-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useMarkdownTools } from "../../utils/markdown";
import { generateUUID } from "~/lib/utils";
import { useAgentWorkflow } from "./use-agent-workflow";
import { CHAT_CAPABILITY, prepareChat } from "~/lib/generation/chat";
interface SendQueryParams {
  prompt: string;
  editorStateJson?: string;
  files?: File[] | FileList | null;
}
export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { convertEditorStateToMarkdown } = useMarkdownTools();
  const { runAgentWorkflow } = useAgentWorkflow({ onError: () => {} });
  const inFlight = useRef(false);
  return useCallback(
    async ({ prompt, editorStateJson, files }: SendQueryParams) => {
      if (inFlight.current || !prompt.trim()) return;
      inFlight.current = true;
      try {
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
        if (
          messages.some(
            (message) =>
              (message.toolCalls?.length ?? 0) > 0 ||
              (message.toolResults?.length ?? 0) > 0 ||
              message.role === "system",
          )
        ) {
          dispatch({
            type: "push",
            msg: {
              id: generateUUID(),
              role: "assistant",
              content: CHAT_CAPABILITY,
            },
          });
          return;
        }
        const history = messages
          .filter((message) => message.content.trim())
          .map(({ role, content }) => ({ role, content }));
        const attachments = await Promise.all(
          Array.from(files ?? []).map(async (file) => {
            if (
              !["text/plain", "text/markdown"].includes(file.type) ||
              file.size > 1500
            )
              throw new Error(CHAT_CAPABILITY);
            return {
              name: file.name,
              type: file.type,
              text: await file.text(),
            };
          }),
        );
        const context = convertEditorStateToMarkdown(editor.getEditorState());
        prepareChat({ prompt, messages: history, context, files: attachments });
        dispatch({
          type: "push",
          msg: {
            id: generateUUID(),
            role: "user",
            content:
              prompt +
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
          prompt,
          messages: history,
          context,
          files,
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
      messages,
      generateChatStream,
      runAgentWorkflow,
      convertEditorStateToMarkdown,
      editor,
    ],
  );
};
