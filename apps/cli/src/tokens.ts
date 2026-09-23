import { CliError } from "./errors";
import type { Env } from "./context";

export const KEYCHAIN_SERVICE = "cli/lexidraw";

/** The keychain behind an interface so tests never touch the real one. */
export type TokenStore = {
  get(account: string): string | null;
  set(account: string, token: string): void;
};

export const keychainStore: TokenStore = {
  get(account) {
    const result = Bun.spawnSync({
      cmd: [
        "security",
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return null;
    const token = result.stdout.toString().trim();
    return token === "" ? null : token;
  },
  set(account, token) {
    const result = Bun.spawnSync({
      cmd: [
        "security",
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
        token,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new CliError(
        "KEYCHAIN",
        `storing the token failed: ${result.stderr.toString().trim()}`,
      );
    }
  },
};

export type TokenSource = "env" | "keychain" | "none";

export type ResolvedToken =
  | { token: string; source: "env" | "keychain" }
  | { token: null; source: "none" };

/** The env var wins, so one call can run as someone else without a rewrite. */
export function resolveToken(
  account: string,
  env: Env,
  store: TokenStore,
): ResolvedToken {
  const fromEnv = env.LEXIDRAW_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  const stored = store.get(account)?.trim();
  if (stored) return { token: stored, source: "keychain" };
  return { token: null, source: "none" };
}

export function requireToken(
  account: string,
  env: Env,
  store: TokenStore,
): { token: string; source: "env" | "keychain" } {
  const resolved = resolveToken(account, env, store);
  if (resolved.token === null) {
    throw new CliError(
      "NO_TOKEN",
      `no token for profile "${account}"; set LEXIDRAW_TOKEN or run: lexidraw auth login --profile ${account}`,
      { details: { profile: account, tokenSource: "none" } },
    );
  }
  return resolved;
}
