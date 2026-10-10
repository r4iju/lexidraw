import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateText } from "ai";
import { prepareAutocomplete } from "~/lib/generation/autocomplete";
import {
  finishFragment,
  fragmentAt,
} from "~/lib/generation/autocomplete-fragment";
import { AutocompleteInput, Completion, PRICEBOOK, Usage } from "./contracts";
import type { ProTransport } from "./operation";

type SdkFetch = NonNullable<
  NonNullable<Parameters<typeof createOpenAI>[0]>["fetch"]
>;
type ProviderFetch = (...args: Parameters<SdkFetch>) => ReturnType<SdkFetch>;
/** This adapter alone resolves the app-owned key, after the persisted attempt fence. */
export function createProProviderTransport(deps: {
  authorize: (context: Parameters<ProTransport>[2]) => Promise<void>;
  resolveServerKey: () => string | undefined;
  fetch?: ProviderFetch;
}): ProTransport {
  if (process.env.NODE_ENV === "test" && !deps.fetch)
    throw new Error("Tests must inject Pro transport");
  return async (text, signal, context) => {
    await deps.authorize(context);
    if (new TextEncoder().encode(text).length > PRICEBOOK.maxInputBytes)
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    const key = deps.resolveServerKey();
    if (!key) return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    const input =
      context.feature === "autocomplete"
        ? AutocompleteInput.omit({ idempotencyKey: true }).parse(
            JSON.parse(text),
          )
        : { title: "", before: text, after: "" };
    const prepared = prepareAutocomplete({
      ...input,
      config: {
        provider: PRICEBOOK.provider,
        modelId: PRICEBOOK.model,
        temperature: 0.2,
        maxOutputTokens:
          context.feature === "autocomplete" ? 64 : PRICEBOOK.maxOutputTokens,
      },
    });
    // The shared continuation prompt may repeat the final word. Bound the complete prepared request, including a 256-token message framing margin.
    if (
      new TextEncoder().encode(prepared.system + prepared.prompt).length + 256 >
      PRICEBOOK.maxInputTokens
    )
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    try {
      const result = await generateText({
        model: createOpenAI({
          apiKey: key,
          fetch: Object.assign(
            async (...args: Parameters<SdkFetch>) => {
              await deps.authorize(context);
              const [url, init] = args;
              if (String(url) !== "https://api.openai.com/v1/responses")
                throw new Error("Provider path rejected");
              return (deps.fetch ?? globalThis.fetch)(url, {
                ...init,
                redirect: "error",
              });
            },
            { preconnect: () => {} },
          ),
        }).responses(PRICEBOOK.model),
        system: prepared.system,
        prompt: prepared.prompt,
        maxOutputTokens: prepared.config.maxOutputTokens,
        headers: { "X-Client-Request-Id": context.attemptId },
        maxRetries: 0,
        abortSignal: signal,
        providerOptions: prepared.providerOptions,
      });
      const usage = Usage.parse({
        input: result.totalUsage.inputTokens,
        cachedInput: result.totalUsage.inputTokenDetails.cacheReadTokens ?? 0,
        output: result.totalUsage.outputTokens,
      });
      const cost =
        (usage.input - usage.cachedInput) * PRICEBOOK.inputNanoUsd +
        usage.cachedInput * PRICEBOOK.cachedInputNanoUsd +
        usage.output * PRICEBOOK.outputNanoUsd;
      const output = finishFragment(fragmentAt(input.before), result.text);
      if (!output)
        return { kind: "failed", retryable: false, actualCostNanoUsd: cost };
      return {
        kind: "completed",
        completion: Completion.parse({
          text: output,
          usage,
          actualCostNanoUsd: cost,
          providerResponseId: result.response.id,
        }),
      };
    } catch (error) {
      if (
        APICallError.isInstance(error) &&
        error.statusCode &&
        [400, 401, 403, 404, 422, 429].includes(error.statusCode)
      )
        return {
          kind: "failed",
          retryable: error.statusCode === 429,
          actualCostNanoUsd: 0,
        };
      // A network/SDK exception does not establish whether upstream completed or billed.
      return { kind: "unknown" };
    }
  };
}
