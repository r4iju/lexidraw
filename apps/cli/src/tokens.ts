import type { Env } from "./env";
import { CliError, describe } from "./errors";
import { keychainRefusal, type Profile } from "./profile";

export const KEYCHAIN_SERVICE = "cli/lexidraw";

/** `security` says "no such item" with this status; anything else is a fault. */
const NOT_FOUND_EXIT = 44;

const FALLBACK_HINT = "set LEXIDRAW_TOKEN instead";

/** The keychain behind an interface so tests never touch the real one. */
export type TokenStore = {
  get(account: string): string | null;
  set(account: string, token: string): void;
};

type Run = { exitCode: number; stdout: string; stderr: string };

export function createKeychainStore(command = "security"): TokenStore {
  const run = (args: string[], stdin?: string): Run => {
    try {
      const result = Bun.spawnSync({
        cmd: [command, ...args],
        stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout?.toString() ?? "",
        stderr: result.stderr?.toString().trim() ?? "",
      };
    } catch (cause) {
      throw new CliError(
        "KEYCHAIN_UNAVAILABLE",
        `could not run ${command}: ${describe(cause)}; ${FALLBACK_HINT}`,
      );
    }
  };

  return {
    get(account) {
      const result = run([
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
      ]);
      if (result.exitCode === NOT_FOUND_EXIT) return null;
      if (result.exitCode !== 0) {
        throw new CliError(
          "KEYCHAIN_UNAVAILABLE",
          `reading the keychain failed (exit ${result.exitCode}): ${result.stderr}; ${FALLBACK_HINT}`,
        );
      }
      const token = result.stdout.trim();
      return token === "" ? null : token;
    },

    set(account, token) {
      // The command goes in on stdin: an argument is visible to every process
      // on the machine for as long as `security` runs.
      const result = run(
        ["-i"],
        `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${quote(account)} -w ${quote(token)}\n`,
      );
      if (result.exitCode !== 0) {
        throw new CliError(
          "KEYCHAIN",
          `storing the token failed (exit ${result.exitCode}): ${result.stderr}`,
        );
      }
    },
  };
}

export const keychainStore: TokenStore = createKeychainStore();

/** `security -i` splits on whitespace and honours double quotes. */
function quote(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

export type TokenSource = "env" | "keychain" | "none";

export type ResolvedToken =
  | { token: string; source: "env" | "keychain" }
  | { token: null; source: "none" };

/** The env var wins, so one call can run as someone else without a rewrite. */
export function resolveToken(
  profile: Profile,
  env: Env,
  store: TokenStore,
): ResolvedToken {
  const fromEnv = env.LEXIDRAW_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  if (!profile.keychainAllowed) return { token: null, source: "none" };
  const stored = store.get(profile.name)?.trim();
  if (stored) return { token: stored, source: "keychain" };
  return { token: null, source: "none" };
}

export function requireToken(
  profile: Profile,
  env: Env,
  store: TokenStore,
): { token: string; source: "env" | "keychain" } {
  const resolved = resolveToken(profile, env, store);
  if (resolved.token === null) {
    throw new CliError(
      "NO_TOKEN",
      profile.keychainAllowed
        ? `no token for profile "${profile.name}"; set LEXIDRAW_TOKEN or run: lexidraw auth login --profile ${profile.name}`
        : `no token for ${profile.origin}: ${keychainRefusal(profile)}`,
      {
        details: {
          profile: profile.name,
          baseUrl: profile.baseUrl,
          tokenSource: "none",
        },
      },
    );
  }
  return resolved;
}
