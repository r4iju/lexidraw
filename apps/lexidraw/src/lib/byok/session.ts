import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  generateAutocomplete,
  createCredentialReference,
  type CredentialReference,
  type TextTransport,
} from "../generation/autocomplete";

export type ByokProvider = "openrouter";
type Network = (request: Request) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const ProviderTextResponse = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});
const blocked = () => new Error("Credential egress blocked");
const unavailable = () =>
  new Error(
    "Direct provider access unavailable. Check your key, permissions, or browser connection.",
  );

export function createByokSession(network: Network, origin: string) {
  let active: { reference: CredentialReference; key: string } | undefined;
  const known = new Map<string, { prefix: string; length: number }>();
  const fingerprint = (text: string) =>
    bytesToHex(sha256(new TextEncoder().encode(text)));
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  function assertSafe(value: string) {
    if (known.size === 0) return;
    const minKeyLength = Math.min(
      ...Array.from(known.values(), (key) => key.length),
    );
    const pending = [value];
    const seen = new Set<string>();
    while (pending.length) {
      const text = pending.pop();
      if (text === undefined || seen.has(text)) continue;
      seen.add(text);
      for (const [digest, secret] of known) {
        let offset = text.indexOf(secret.prefix);
        while (offset !== -1) {
          if (
            fingerprint(text.slice(offset, offset + secret.length)) === digest
          )
            throw blocked();
          offset = text.indexOf(secret.prefix, offset + 1);
        }
      }

      try {
        pending.push(decodeURIComponent(text));
      } catch {
        /* Not URI encoded. */
      }
      pending.push(
        text.replace(/\\u([a-f0-9]{4})/gi, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
      );
      pending.push(
        text.replace(/&#(x[a-f0-9]+|[0-9]+);/gi, (_, code: string) =>
          String.fromCharCode(
            Number.parseInt(
              code.startsWith("x") ? code.slice(1) : code,
              code.startsWith("x") ? 16 : 10,
            ),
          ),
        ),
      );
      for (const hex of text.match(/(?:[a-f0-9]{2}){12,}/gi) ?? []) {
        if (hex.length < minKeyLength * 2) continue;
        pending.push(
          hex.replace(/[a-f0-9]{2}/gi, (byte) =>
            String.fromCharCode(Number.parseInt(byte, 16)),
          ),
        );
      }
      for (const token of text.match(/[A-Za-z0-9+/_-]{12,}={0,2}/g) ?? []) {
        if (token.length < Math.ceil((minKeyLength * 4) / 3)) continue;
        try {
          pending.push(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
        } catch {
          /* Not base64. */
        }
      }
    }
  }
  function assertEgress(value: string) {
    assertSafe(value);
    if (
      known.size &&
      /"(?:apiKey|baseURL|providerOptions|rawResponse|providerConfig|requestBody|providerMetadata|choices)"\s*:/.test(
        value,
      )
    )
      throw blocked();
  }
  function replace(provider: ByokProvider, key: string) {
    if (provider !== "openrouter") throw unavailable();
    if (key.length < 12 || key.length > 1024 || /\s/.test(key))
      throw unavailable();
    known.set(fingerprint(key), {
      prefix: key.slice(0, 4),
      length: key.length,
    });
    const reference = createCredentialReference();
    active = { reference, key };
    notify();
    return reference;
  }
  async function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), origin),
      init,
    );
    assertSafe(request.url);
    request.headers.forEach((value, name) => {
      assertSafe(name);
      assertSafe(value);
    });
    const body = await request.clone().text();
    assertSafe(request.url);
    request.headers.forEach((value, name) => {
      assertSafe(name);
      assertSafe(value);
    });
    assertEgress(body);
    return network(request);
  }
  async function requestText(
    reference: CredentialReference,
    prompt: string,
    system = "",
    maxTokens = 16,
    signal?: AbortSignal,
  ) {
    if (active?.reference !== reference) throw unavailable();
    if (prompt.length > 5000 || system.length > 4000) throw unavailable();
    assertSafe(prompt);
    assertSafe(system);
    const request = new Request(endpoint, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${active.key}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0,
      }),
    });
    try {
      const response = await network(request);
      if (!response.ok || response.redirected) throw unavailable();
      const body = await response.text();
      if (active?.reference !== reference) throw unavailable();
      assertSafe(body);
      const result = ProviderTextResponse.safeParse(JSON.parse(body));
      if (!result.success) throw unavailable();
      return result.data.choices[0]?.message.content ?? "";
    } catch {
      throw unavailable();
    }
  }
  async function autocomplete(
    reference: CredentialReference,
    before: string,
    options: { title?: string; after?: string; signal?: AbortSignal } = {},
  ) {
    const transport: TextTransport = {
      stream(request, signal, persistence) {
        return new ReadableStream<string>({
          async start(controller) {
            try {
              const result = await requestText(
                request.credential,
                request.prompt,
                request.system,
                request.config.maxOutputTokens,
                signal,
              );
              if (signal.aborted) throw unavailable();
              controller.enqueue(result);
              controller.close();
            } catch {
              const error = unavailable();
              await persistence.error(error);
              controller.error(error);
            }
          },
        });
      },
    };
    const stream = generateAutocomplete(
      {
        title: options.title ?? "",
        before,
        after: options.after ?? "",
        credential: reference,
        config: {
          provider: "openrouter",
          modelId: "openai/gpt-4.1-mini",
          temperature: 0,
          maxOutputTokens: 64,
        },
      },
      {
        transport,
        execution: {
          run: (start) => start(options.signal ?? new AbortController().signal),
        },
        persistence: { finish() {}, error() {} },
      },
    );
    let result = "";
    for await (const part of stream) result += part;
    return result;
  }
  return {
    replace,
    remove() {
      active = undefined;
      notify();
    },
    reference: () => active?.reference,
    protected: () => known.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    fetch: guardedFetch,
    text: (reference: CredentialReference, prompt: string) =>
      requestText(reference, prompt),
    autocomplete,
    assertSafe,
    assertEgress,
  };
}
