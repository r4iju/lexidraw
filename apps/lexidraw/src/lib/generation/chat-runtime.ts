import type { ChatQuote } from "./chat-client";
import type { ChatInput } from "./chat";
export type ChatRuntime = {
  source: "local" | "byok" | "pro";
  available: boolean;
  reason?: string;
  run(
    input: ChatInput,
    signal: AbortSignal,
    onText: (text: string) => void,
    confirm: (quote: ChatQuote) => Promise<boolean>,
  ): Promise<string>;
};
