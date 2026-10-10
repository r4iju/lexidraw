import { prepareChat } from "../../lexidraw/src/lib/generation/chat";
export function nativeChatRequest(json: string) {
  const request = prepareChat(JSON.parse(json));
  return {
    model: "openai/gpt-4.1-mini",
    messages: [
      { role: "system", content: request.system },
      ...request.messages,
    ],
    temperature: 0,
    max_tokens: request.maxOutputTokens,
    stream: true,
  };
}
export function nativeLocalChatRequest(json: string) {
  const request = prepareChat(JSON.parse(json));
  return {
    system: request.system,
    prompt: request.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n"),
    maximumResponseTokens: request.maxOutputTokens,
  };
}
