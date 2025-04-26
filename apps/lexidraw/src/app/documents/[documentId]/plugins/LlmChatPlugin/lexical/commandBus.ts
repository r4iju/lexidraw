import { LexicalEditor } from "lexical";
import { useToolExecutors } from "./toolExecutors";
import type { AppToolCall } from "../../../context/llm-context";

/**
 * @param editor The current LexicalEditor instance.
 */
export function useDispatchToolCalls(editor: LexicalEditor) {
  const { toolExecutors } = useToolExecutors(editor);

  function dispatchToolCalls(calls: AppToolCall[] | undefined): void {
    if (!calls || calls.length === 0) {
      // already logged in useSendQuery
      return;
    }

    console.log(`Attempting to dispatch ${calls.length} tool call(s)...`);

    calls.forEach((call: AppToolCall) => {
      // basic validation of the call object structure
      if (!call || typeof call.toolName !== "string") {
        console.warn("Received invalid tool call object:", call);
        return; // invalid call, skip
      }

      const executor = toolExecutors[call.toolName];
      if (typeof executor === "function") {
        try {
          console.log(
            `Dispatching tool call: ${call.toolName} with args:`,
            call.args,
          );

          executor(call.args);
        } catch (error) {
          console.error(`Error executing tool ${call.toolName}:`, error);
        }
      } else {
        console.warn(
          `Unknown toolName encountered: ${call.toolName}. No executor found.`,
        );
        // TODO: handle unknown tools - maybe send a message back to the user/LLM?
      }
    });
  }

  return { dispatchToolCalls };
}
