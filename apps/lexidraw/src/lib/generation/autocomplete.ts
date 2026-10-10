import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { fragmentAt, stripFragment } from "./autocomplete-fragment";
import {
  AUTOCOMPLETE_SYSTEM,
  MAX_SUGGESTION_TOKENS,
  autocompletePrompt,
  lowestReasoning,
} from "./autocomplete-prompt";

const credentialBrand: unique symbol = Symbol("credential-reference");
/** Runtime-local identity. Only the transport can resolve it to a credential. */
export type CredentialReference = { readonly [credentialBrand]: true };
export function createCredentialReference(): CredentialReference {
  return Object.freeze({ [credentialBrand]: true });
}

export type TextModelConfig = {
  provider: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
};
export type TextUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
export type TextPersistence = {
  finish(usage: TextUsage): void | Promise<void>;
  error(error: unknown): void | Promise<void>;
};
export type TextGenerationRequest = {
  config: TextModelConfig;
  credential: CredentialReference;
  system: string;
  prompt: string;
  maxRetries: number;
  providerOptions?: ProviderOptions;
};
export type TextTransport = {
  stream(
    request: TextGenerationRequest,
    signal: AbortSignal,
    persistence: TextPersistence,
  ): ReadableStream<string>;
};
export type TextExecution = {
  run<T>(start: (signal: AbortSignal) => T): T;
};
export type AutocompleteJob = {
  title: string;
  before: string;
  after: string;
  config: TextModelConfig;
  credential: CredentialReference;
};

export function generateAutocomplete(
  job: AutocompleteJob,
  adapters: {
    transport: TextTransport;
    execution: TextExecution;
    persistence: TextPersistence;
  },
): ReadableStream<string> {
  const config: TextModelConfig = {
    provider: job.config.provider,
    modelId: job.config.modelId,
    temperature: job.config.temperature,
    maxOutputTokens: Math.min(
      job.config.maxOutputTokens,
      MAX_SUGGESTION_TOKENS,
    ),
  };
  return adapters.execution
    .run((signal) =>
      adapters.transport.stream(
        {
          config,
          credential: job.credential,
          system: AUTOCOMPLETE_SYSTEM,
          prompt: autocompletePrompt(job),
          // A retried suggestion arrives after the user has typed past it.
          maxRetries: 0,
          providerOptions: lowestReasoning(config.provider, config.modelId),
        },
        signal,
        adapters.persistence,
      ),
    )
    .pipeThrough(stripFragment(fragmentAt(job.before)));
}
