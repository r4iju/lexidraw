import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Env, Io } from "../src/context";

export type FakeIo = {
  io: Io;
  stored: Map<string, string>;
  /** Accounts `get` was asked for, so a test can prove the keychain was
   * never consulted. */
  lookups: string[];
  echo: boolean[];
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
  const lookups: string[] = [];
  const echo: boolean[] = [];
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
        get: (account) => {
          lookups.push(account);
          return stored.get(account) ?? null;
        },
        set: (account, token) => {
          stored.set(account, token);
        },
      },
      stdinIsTty: options.tty ?? false,
      readLine: async () => options.stdin ?? "",
      readAll: async () => options.stdin ?? "",
      setEcho: (on) => {
        echo.push(on);
      },
    },
    stored,
    lookups,
    echo,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

export type Stub = {
  baseUrl: string;
  requests: {
    method: string;
    path: string;
    auth: string | null;
    body: string;
  }[];
  stop(): void;
};

/** A local stand-in for `/api/v1`, so the HTTP path is exercised for real. */
export function startStub(
  handler: (url: URL, request: Request) => Response | Promise<Response>,
): Stub {
  const requests: Stub["requests"] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      // Read before the handler, which would otherwise consume the body.
      const body = await request.clone().text();
      requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        auth: request.headers.get("authorization"),
        body,
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

/** A fake `security` on disk, so the keychain paths are tested without one. */
export async function writeShim(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lexidraw-shim-"));
  const path = join(dir, "security");
  await Bun.write(path, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}
