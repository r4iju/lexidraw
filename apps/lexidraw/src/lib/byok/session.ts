import { ChatRequest, type ChatPort } from "../generation/chat";
import { providerChatStream } from "../generation/chat-stream";
import {
  DEVICE_AGENT_UNAVAILABLE,
  deviceAgentRequest,
  type AgentCheckpoint,
} from "../agent/device-core";
import {
  audioFromPCM,
  speechRequest,
  SPEECH_PATH,
  DEVICE_NARRATION_UNAVAILABLE,
} from "../narration/portable";
import { validateImagePixels } from "../images/pixels";
import { imageRequest } from "../images/format";
import {
  validateImage,
  IMAGE_MAX_PROMPT_BYTES,
  IMAGE_UNAVAILABLE,
} from "../images/contracts";
import { z } from "zod";
import { canonicalWav, compressionInspector } from "./audio-safety";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  generateAutocomplete,
  createCredentialReference,
  type CredentialReference,
  type TextTransport,
} from "../generation/autocomplete";

export const CredentialFingerprints = z
  .array(
    z.strictObject({
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      prefix: z.string().max(4),
      length: z.number().int().min(12).max(4096),
    }),
  )
  .max(128);
export type ByokProvider = "openrouter";
type Network = (request: Request) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_WIRE_BYTES = 64 * 1024;
const TEXT_OUTPUT_BYTES = { text: 256, autocomplete: 1024 };
const ProviderTextResponse = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().max(1024) }) }))
    .length(1),
});
const blocked = () => new Error("Credential egress blocked");
const unavailable = () =>
  new Error(
    "Direct provider access unavailable. Check your key, permissions, or browser connection.",
  );

export function createByokSession(
  network: Network,
  origin: string,
  options: {
    imageFixture?: true;
    narrationFixture?: true;
    agentFixture?: true;
    chatFixture?: true;
  } = {},
) {
  let active: { reference: CredentialReference; key: string } | undefined;
  const known = new Map<string, { prefix: string; length: number }>();
  const fingerprint = (text: string) =>
    bytesToHex(sha256(new TextEncoder().encode(text)));
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  function assertSafe(value: string, pcm = false) {
    if (value.length > 512 * 1024 * 1024) throw blocked();
    let decodedWork = 0;
    let fingerprintChecks = 0;
    const pixelTexts: string[] = [];
    function checkKnown(text: string) {
      for (const [digest, secret] of known) {
        let offset = text.indexOf(secret.prefix);
        while (offset !== -1) {
          if (++fingerprintChecks > 16_384) throw blocked();
          if (
            fingerprint(text.slice(offset, offset + secret.length)) === digest
          )
            throw blocked();
          offset = text.indexOf(secret.prefix, offset + 1);
        }
      }
    }
    const samples = pcm || canonicalWav(value);
    const inspectCompression = compressionInspector(samples, (binary) => {
      checkKnown(binary);
      // Only textual runs enter the canonical decoder; binary pixel samples
      // retain byte inspection without acquiring text-format assumptions.
      for (const match of binary.matchAll(/[\x09\x0a\x0d\x20-\x7e]{8,}/g))
        pixelTexts.push(match[0]);
    });
    const initialDecoded = inspectCompression(value, samples);
    if (/sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{16,}/.test(value)) throw blocked();
    const minKeyLength = Math.min(
      ...Array.from(known.values(), (key) => key.length),
      16,
    );
    const pending = [value, ...initialDecoded];
    const seen = new Set<string>();
    while (pending.length || pixelTexts.length) {
      // Append individually: a bounded image can still have many short runs.
      while (pixelTexts.length) pending.push(pixelTexts.pop() ?? "");
      const text = pending.pop();
      if (text === undefined || seen.has(text)) continue;
      seen.add(text);
      decodedWork += text.length;
      if (decodedWork > 512 * 1024 * 1024) throw blocked();
      if (text !== value)
        pending.push(...inspectCompression(text, canonicalWav(text)));
      // Every decoded node has its own format check; sample status is never inherited.
      if (
        /sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{16,}/.test(text) ||
        /"(?:apiKey|baseURL|providerOptions|rawResponse|providerConfig|requestBody|providerMetadata)"\s*:/.test(
          text,
        )
      )
        throw blocked();
      checkKnown(text);

      // Decode independent runs so unrelated malformed escapes cannot hide a key.
      // Replacement UTF-8 decoding also preserves ASCII keys beside invalid bytes.
      const percentDecoded = text.replace(/(?:%[a-f0-9]{2})+/gi, (run) =>
        new TextDecoder().decode(
          Uint8Array.from(run.match(/[a-f0-9]{2}/gi) ?? [], (byte) =>
            Number.parseInt(byte, 16),
          ),
        ),
      );
      // Every percent pass shrinks the input, bounding nested decoding by its size.
      if (percentDecoded.length < text.length) pending.push(percentDecoded);
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
    if (request.headers.has("Content-Encoding")) throw blocked();
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
    maxOutputBytes = TEXT_OUTPUT_BYTES.text,
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
      if (
        !response.ok ||
        response.redirected ||
        response.headers.has("Content-Encoding")
      )
        throw unavailable();
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      request.signal.addEventListener("abort", abort, { once: true });
      let body = "";
      let size = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for (;;) {
          if (request.signal.aborted || active?.reference !== reference)
            throw unavailable();
          const next = await reader.read();
          if (request.signal.aborted || active?.reference !== reference)
            throw unavailable();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > TEXT_WIRE_BYTES) throw unavailable();
          body += decoder.decode(next.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        request.signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = ProviderTextResponse.safeParse(JSON.parse(body));
      if (!result.success) throw unavailable();
      const content = result.data.choices[0]?.message.content ?? "";
      if (new TextEncoder().encode(content).byteLength > maxOutputBytes)
        throw unavailable();
      assertSafe(body);
      return content;
    } catch {
      throw unavailable();
    }
  }
  function chat(reference: CredentialReference): ChatPort {
    return {
      async *stream(value, signal) {
        if (!options.chatFixture)
          throw new Error(
            "Direct chat is unavailable until provider streaming and bounds are verified. Your saved history is preserved.",
          );
        const input = ChatRequest.parse(value);
        assertSafe(JSON.stringify(input));
        if (signal.aborted || active?.reference !== reference)
          throw unavailable();
        const request = new Request(endpoint, {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${active.key}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-4.1-mini",
            messages: [
              { role: "system", content: input.system },
              ...input.messages,
            ],
            max_tokens: input.maxOutputTokens,
            temperature: 0,
            stream: true,
          }),
        });
        try {
          const response = await network(request);
          yield* providerChatStream(
            response,
            request.signal,
            assertSafe,
            () => active?.reference === reference,
          );
        } catch {
          throw new Error(
            "Chat provider outcome uncertain. No automatic repeat was performed.",
          );
        }
      },
    };
  }
  async function agent(reference: CredentialReference, state: AgentCheckpoint) {
    if (!options.agentFixture) throw new Error(DEVICE_AGENT_UNAVAILABLE);
    const body = JSON.stringify(deviceAgentRequest(state));
    assertEgress(body);
    if (active?.reference !== reference) throw unavailable();
    const request = new Request(endpoint, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${active.key}`,
      },
      body,
    });
    try {
      const response = await network(request);
      if (
        !response.ok ||
        response.redirected ||
        response.headers.has("Content-Encoding")
      )
        throw unavailable();
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 16_384) {
            await reader.cancel();
            throw unavailable();
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      assertSafe(text);
      const content = ProviderTextResponse.parse(JSON.parse(text)).choices[0]
        ?.message.content;
      if (!content || new TextEncoder().encode(content).length > 3000)
        throw unavailable();
      return content;
    } catch {
      throw new Error(
        "Provider outcome uncertain. No automatic repeat was performed.",
      );
    }
  }
  async function image(reference: CredentialReference, prompt: string) {
    if (!options.imageFixture) throw new Error(IMAGE_UNAVAILABLE);
    if (
      active?.reference !== reference ||
      new TextEncoder().encode(prompt).length > IMAGE_MAX_PROMPT_BYTES
    )
      throw unavailable();
    assertSafe(prompt);
    const request = new Request("https://openrouter.ai/api/v1/images", {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${active.key}`,
      },
      // This synthetic model is used only by injected transports. It cannot be enabled in production.
      body: JSON.stringify(imageRequest(prompt)),
    });
    try {
      const response = await network(request);
      if (!response.ok || response.redirected) throw unavailable();
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 3 * 1024 * 1024 || active?.reference !== reference) {
            await reader.cancel();
            throw unavailable();
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (active?.reference !== reference) throw unavailable();
      assertSafe(text);
      const parsed = z
        .object({
          data: z
            .array(
              z.object({
                b64_json: z.string(),
                media_type: z.literal("image/png"),
              }),
            )
            .length(1),
        })
        .parse(JSON.parse(text));
      const item = parsed.data[0];
      if (!item) throw unavailable();
      const validated = validateImage(
        {
          base64: item.b64_json,
          mimeType: item.media_type,
          width: 1024,
          height: 1024,
        },
        assertSafe,
      );
      await validateImagePixels(validated.bytes);
      return validated.image;
    } catch {
      throw new Error(
        "Image provider unavailable. No automatic regeneration was performed.",
      );
    }
  }
  async function narrate(reference: CredentialReference, text: string) {
    if (!options.narrationFixture)
      throw new Error(DEVICE_NARRATION_UNAVAILABLE);
    if (active?.reference !== reference) throw unavailable();
    assertSafe(text);
    const body = JSON.stringify(speechRequest(text));
    assertEgress(body);
    const request = new Request(`https://openrouter.ai${SPEECH_PATH}`, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(180_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${active.key}`,
      },
      body,
    });
    // No awaits between this credential check and dispatch.
    if (active?.reference !== reference) throw unavailable();
    try {
      const response = await network(request);
      if (
        !response.ok ||
        response.redirected ||
        response.headers.get("Content-Type")?.split(";")[0] !== "audio/pcm" ||
        response.headers.has("Content-Encoding")
      )
        throw unavailable();
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const parts: Uint8Array[] = [];
      let count = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          count += next.value.length;
          if (count > 5_760_000) {
            await reader.cancel();
            throw unavailable();
          }
          parts.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      // Retired fingerprints still guard late usable output after key removal.
      return audioFromPCM(bytes, (text) => assertSafe(text, true));
    } catch {
      throw new Error(
        "Provider outcome uncertain. No automatic repeat was performed.",
      );
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
                TEXT_OUTPUT_BYTES.autocomplete,
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
    fingerprints: () =>
      Array.from(known, ([digest, value]) => ({ digest, ...value })),
    restoreFingerprints(value: unknown) {
      for (const { digest, prefix, length } of CredentialFingerprints.parse(
        value,
      ))
        known.set(digest, { prefix, length });
    },
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
    chat,
    narrate,
    image,
    agent,
    assertSafe: (text: string) => assertSafe(text),
    assertEgress,
  };
}
