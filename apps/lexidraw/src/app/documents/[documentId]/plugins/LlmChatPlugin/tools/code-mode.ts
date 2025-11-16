import { tool } from "ai";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import env from "@packages/env";
import {
  exportLexicalToJson,
  importJsonIntoLexical,
  runInIframeSandbox,
} from "../code-mode";
import { ExecuteCodeClientSchema } from "@packages/types";

export const useClientCodeModeTools = () => {
  const [editor] = useLexicalComposerContext();

  const executeCodeClient = tool({
    description:
      "Run small browser-sandboxed code that returns a document update; the host applies to Lexical.",
    inputSchema: ExecuteCodeClientSchema,
    execute: async (options) => {
      const { code, timeoutMs } = options as {
        code: string;
        timeoutMs?: number;
        maxOps?: number;
      };

      // Export current editor state to JSON snapshot (implementation-specific)
      const initialDoc = exportLexicalToJson(() =>
        editor.getEditorState().toJSON(),
      );

      const iframeSrc = env.NEXT_PUBLIC_CODE_MODE_RUNNER_URL;
      if (!iframeSrc) {
        throw new Error(
          "Code Mode runner URL is not configured. Set NEXT_PUBLIC_CODE_MODE_RUNNER_URL.",
        );
      }

      const response = await runInIframeSandbox({
        iframeSrc,
        code,
        initialDoc,
        timeoutMs: timeoutMs ?? 15_000,
        // Optionally restrict to exact origin if iframeSrc is absolute
        allowedOrigin: (() => {
          try {
            const url = new URL(iframeSrc, globalThis.location?.href);
            return `${url.protocol}//${url.host}`;
          } catch {
            return undefined;
          }
        })(),
      });

      if (!response.ok) {
        return {
          success: false as const,
          error: response.error || "Sandbox error",
        };
      }

      // Apply new document if provided
      if (response.newDoc !== undefined) {
        importJsonIntoLexical(response.newDoc, editor);
      }

      return {
        success: true as const,
        content: {
          summary:
            "Executed code in browser sandbox and applied document changes.",
          logs:
            Array.isArray((response as { logs?: string[] }).logs) &&
            (response as { logs?: string[] }).logs
              ? (response as { logs?: string[] }).logs
              : undefined,
        },
      };
    },
  });

  return {
    executeCodeClient,
  };
};
