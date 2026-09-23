import type { Env, Io } from "../src/context";

export type FakeIo = {
  io: Io;
  stored: Map<string, string>;
  stdout(): string;
  stderr(): string;
};

export function fakeIo(
  options: {
    env?: Env;
    tokens?: Record<string, string>;
    stdin?: string;
    tty?: boolean;
  } = {},
): FakeIo {
  const stored = new Map(Object.entries(options.tokens ?? {}));
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      env: options.env ?? {},
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
      tokens: {
        get: (account) => stored.get(account) ?? null,
        set: (account, token) => {
          stored.set(account, token);
        },
      },
      stdinIsTty: options.tty ?? false,
      readLine: async () => options.stdin ?? "",
    },
    stored,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

export type Stub = {
  baseUrl: string;
  requests: { method: string; path: string; auth: string | null }[];
  stop(): void;
};

/** A local stand-in for `/api/v1`, so the HTTP path is exercised for real. */
export function startStub(
  handler: (url: URL, request: Request) => Response | Promise<Response>,
): Stub {
  const requests: Stub["requests"] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        auth: request.headers.get("authorization"),
      });
      return handler(url, request);
    },
  });
  return {
    baseUrl: server.url.origin,
    requests,
    stop: () => {
      server.stop(true);
    },
  };
}
