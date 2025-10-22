import "server-only";

import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { headers } from "next/headers";
import { cache } from "react";
import { appRouter, type AppRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const REDACTED = "***";

const SENSITIVE_KEY_REGEXES = [
  /api[-_]?key/i,
  /authorization/i,
  /token/i,
  /secret/i,
  /password/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /client[-_]?secret/i,
  /private[-_]?key/i,
  /openai.*key/i,
  /google.*key/i,
  /cookie/i,
  /session/i,
];

function sanitizeString(str: string): string {
  let s = str;
  // Bearer tokens
  s = s.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`);
  // OpenAI keys (sk-..., sk-proj-...)
  s = s.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, REDACTED);
  s = s.replace(/\bsk-proj-[A-Za-z0-9\-._]{10,}\b/g, REDACTED);
  // Google API keys (AIza...)
  s = s.replace(/\bAIza[0-9A-Za-z\-_]{10,}\b/g, REDACTED);
  // JWTs (three base64url segments)
  s = s.replace(
    /\b[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g,
    REDACTED,
  );
  // Generic long secret-ish strings
  if (s.length >= 32 && /[A-Za-z0-9+/=_-]{32,}/.test(s)) {
    return REDACTED;
  }
  return s;
}

function sanitizeForLog(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();

  function _sanitize(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return sanitizeString(val);
    if (
      typeof val === "number" ||
      typeof val === "boolean" ||
      typeof val === "bigint"
    )
      return val;
    if (val instanceof Date) return val.toISOString();
    if (val instanceof Error) {
      return {
        name: val.name,
        message: sanitizeString(val.message),
        stack: val.stack ? sanitizeString(val.stack) : undefined,
      };
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(val)) return REDACTED;
    if (ArrayBuffer.isView(val as ArrayBufferView)) return REDACTED;
    if (typeof val === "function") return "[Function]";

    if (typeof val === "object") {
      const obj = val as object;
      if (seen.has(obj)) return seen.get(obj);
      if (Array.isArray(val)) {
        const arr: unknown[] = [];
        seen.set(obj, arr);
        for (const item of val as unknown[]) arr.push(_sanitize(item));
        return arr;
      } else {
        const inputRecord = val as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        seen.set(obj, result);
        for (const [k, v] of Object.entries(inputRecord)) {
          const isSensitive = SENSITIVE_KEY_REGEXES.some((re) => re.test(k));
          result[k] = isSensitive ? REDACTED : _sanitize(v);
        }
        return result;
      }
    }
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      return String(val);
    }
  }

  return _sanitize(value);
}

const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");
  return createTRPCContext({
    headers: heads,
  });
});

export const api = createTRPCClient<AppRouter>({
  links: [
    // loggerLink({
    //   enabled: (opts) => {
    //     return (
    //       process.env.NODE_ENV === "development" || opts.direction === "down"
    //     );
    //   },
    // }),
    /**
     * Custom RSC link that lets us invoke procedures without using http requests. Since Server
     * Components always run on the server, we can just call the procedure as a function.
     */
    () =>
      ({ op }) =>
        observable((observer) => {
          console.log(`[tRPC] Starting procedure: ${op.path}`, {
            input: sanitizeForLog(op.input),
            type: op.type,
          });

          createContext()
            .then((ctx) => {
              const caller = appRouter.createCaller(ctx);
              const path = op.path as keyof typeof caller;
              const resolver = caller[path] as unknown;
              if (typeof resolver === "function") {
                return (resolver as (input: unknown) => unknown)(op.input);
              }
              throw new Error(`Invalid procedure path: ${op.path}`);
            })
            .then((data) => {
              console.log(`[tRPC] Success for procedure: ${op.path}`, {
                result: sanitizeForLog(data),
              });
              observer.next({ result: { data } });
              observer.complete();
            })
            .catch((cause) => {
              console.error(`[tRPC] Error in procedure: ${op.path}`, {
                error: sanitizeForLog(cause),
                input: sanitizeForLog(op.input),
                stack:
                  typeof cause === "object" &&
                  cause &&
                  "stack" in cause &&
                  typeof (cause as { stack?: unknown }).stack === "string"
                    ? sanitizeString(
                        (cause as { stack?: string }).stack as string,
                      )
                    : undefined,
                cause:
                  typeof cause === "object" && cause && "cause" in cause
                    ? sanitizeForLog((cause as { cause?: unknown }).cause)
                    : undefined,
              });
              observer.error(TRPCClientError.from(cause));
            });

          return () => {
            // should teardown for
            // - streaming
            // - subscriptions
            // - polling
          };
        }),
  ],
});
