import type { Env } from "./env";
import type { Profile } from "./profile";
import { keychainStore, type TokenStore } from "./tokens";

export type { Env };

/** Everything the commands touch outside themselves, so tests can stand in. */
export type Io = {
  env: Env;
  stdout(text: string): void;
  stderr(text: string): void;
  tokens: TokenStore;
  stdinIsTty: boolean;
  readLine(): Promise<string>;
  /** All of standard input, for `--file -`. */
  readAll(): Promise<string>;
  setEcho(on: boolean): void;
};

export type Context = {
  io: Io;
  profile: Profile;
  refresh: boolean;
};

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One line, so a prompted paste does not wait for end of input. */
async function readLine(): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const newline = buffer.indexOf("\n");
    if (newline !== -1) return buffer.slice(0, newline);
  }
  return buffer;
}

export function realIo(): Io {
  return {
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    tokens: keychainStore,
    stdinIsTty: Boolean(process.stdin.isTTY),
    readLine,
    readAll: () => Bun.stdin.text(),
    setEcho: (on) => {
      Bun.spawnSync({
        cmd: ["stty", on ? "echo" : "-echo"],
        stdin: "inherit",
        stdout: "ignore",
        stderr: "ignore",
      });
    },
  };
}
