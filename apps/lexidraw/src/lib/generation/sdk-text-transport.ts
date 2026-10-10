import { streamText, type LanguageModel } from "ai";
import type {
  CredentialReference,
  TextModelConfig,
  TextTransport,
} from "./autocomplete";

/** The runtime owns SDK construction, networking and credential custody. */
export function createSdkTextTransport(
  resolveModel: (
    credential: CredentialReference,
    config: TextModelConfig,
  ) => LanguageModel,
): TextTransport {
  return {
    stream(request, signal, persistence) {
      const result = streamText({
        model: resolveModel(request.credential, request.config),
        system: request.system,
        prompt: request.prompt,
        temperature: request.config.temperature,
        maxOutputTokens: request.config.maxOutputTokens,
        maxRetries: request.maxRetries,
        providerOptions: request.providerOptions,
        abortSignal: signal,
        onFinish: ({ totalUsage }) =>
          persistence.finish({
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
            totalTokens: totalUsage.totalTokens ?? 0,
          }),
        onError: ({ error }) => persistence.error(error),
      });
      return result.textStream;
    },
  };
}
