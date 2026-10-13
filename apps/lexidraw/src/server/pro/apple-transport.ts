import { createPrivateKey, sign } from "node:crypto";
import type { AppleStatusAPI } from "./apple-billing";

const ORIGIN = "https://api.storekit-sandbox.itunes.apple.com";
const MAX_BYTES = 1_048_576;
export function appleSandboxToken(
  config: {
    key: string;
    keyId: string;
    issuerId: string;
    bundleId: string;
  },
  now = Date.now(),
) {
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(now / 1000);
  const input = `${encoded({ alg: "ES256", kid: config.keyId, typ: "JWT" })}.${encoded({ iss: config.issuerId, iat: issued, exp: issued + 300, aud: "appstoreconnect-v1", bid: config.bundleId })}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(config.key),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${input}.${signature}`;
}

export function createAppleSandboxStatusAPI(deps: {
  token: () => string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): AppleStatusAPI {
  async function read(kind: "transactions" | "subscriptions", id: string) {
    if (!/^\d{1,80}$/.test(id)) throw new Error("Apple status read rejected");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Apple status read rejected"));
      }, deps.timeoutMs ?? 10_000);
    });
    const request = async () => {
      const response = await deps.fetch(`${ORIGIN}/inApps/v1/${kind}/${id}`, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${deps.token()}`,
          accept: "application/json",
        },
      });
      if (
        !response.ok ||
        Number(response.headers.get("content-length") ?? 0) > MAX_BYTES ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error("Apple status read rejected");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) throw new Error("Apple status read rejected");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    try {
      return await Promise.race([request(), deadline]);
    } catch {
      throw new Error("Apple status read rejected");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return {
    getTransactionInfo: (id) => read("transactions", id),
    getAllSubscriptionStatuses: (id) => read("subscriptions", id),
  };
}
