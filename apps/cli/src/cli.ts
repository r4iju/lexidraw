import { apiCommand } from "./api";
import { drawingCommand } from "./drawing";
import { authLogin, authStatus } from "./auth";
import type { Context, Io } from "./context";
import { exitCodeOf, formatError, usageError } from "./errors";
import { PROFILES, resolveProfile } from "./profile";
import { schemaCommand } from "./schema";

const TOP_LEVEL = ["api", "auth", "drawing", "schema"];

/** Flags whose value must not be mistaken for a global flag while scanning. */
const VALUE_FLAGS = [
  "profile",
  "token",
  "json",
  "query",
  "file",
  "title",
  "parent",
  "if-unmodified-since",
];

const USAGE = `lexidraw — Lexidraw from the terminal

Usage:
  lexidraw auth login [--token lxd_...]
  lexidraw auth status
  lexidraw api <METHOD> <path> [--json <body>|@file] [--query k=v ...]
  lexidraw drawing get <id>
  lexidraw drawing put <id> --file <elements.json|-> [--if-unmodified-since <iso>]
  lexidraw drawing create --title <title> [--file <elements.json|->] [--parent <id>]
  lexidraw schema <command> | lexidraw schema --list

Global flags:
  --profile <${Object.keys(PROFILES).join("|")}>  default: prod
  --refresh              ignore the cached OpenAPI document
  --help

Environment:
  LEXIDRAW_PROFILE  profile to use
  LEXIDRAW_URL      base URL override; the keychain is only read when it
                    points at the profile's own host, or at a loopback
                    address on the dev profile
  LEXIDRAW_TOKEN    token, taking precedence over the keychain

Output is JSON on stdout; errors are a JSON object on stderr with a stable
\`code\` and a non-zero exit.
`;

export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return exitCodeOf(error);
  }
}

async function dispatch(argv: readonly string[], io: Io): Promise<number> {
  const globals = takeGlobals(argv);
  const [name, ...tail] = globals.rest;
  if (globals.help || name === undefined || name === "help") {
    io.stdout(USAGE);
    return 0;
  }

  const context: Context = {
    io,
    profile: resolveProfile(globals.profile, io.env),
    refresh: globals.refresh,
  };

  switch (name) {
    case "auth":
      await runAuth(context, tail);
      return 0;
    case "api":
      await apiCommand(context, tail);
      return 0;
    case "drawing":
      await drawingCommand(context, tail);
      return 0;
    case "schema":
      await schemaCommand(context, tail);
      return 0;
    default:
      throw usageError(`unknown command "${name}"`, { known: TOP_LEVEL });
  }
}

async function runAuth(
  context: Context,
  tail: readonly string[],
): Promise<void> {
  switch (tail[0]) {
    case "login":
      return authLogin(context, tail.slice(1));
    case "status":
      return authStatus(context, tail.slice(1));
    default:
      throw usageError("usage: lexidraw auth login|status");
  }
}

type Globals = {
  profile?: string;
  refresh: boolean;
  help: boolean;
  rest: string[];
};

/** Global flags are accepted anywhere, so they are pulled out before the
 * command sees its own arguments. */
export function takeGlobals(argv: readonly string[]): Globals {
  const rest: string[] = [];
  let profile: string | undefined;
  let refresh = false;
  let help = false;

  const setProfile = (value: string) => {
    if (profile !== undefined) {
      throw usageError("--profile was given more than once");
    }
    profile = value;
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "--") {
      rest.push(...argv.slice(index));
      break;
    }
    if (arg === "--refresh") {
      refresh = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--profile") {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw usageError("--profile needs a value");
      setProfile(value);
      continue;
    }
    if (arg.startsWith("--profile=")) {
      setProfile(arg.slice("--profile=".length));
      continue;
    }
    rest.push(arg);
    const flag = arg.startsWith("--") ? arg.slice(2) : "";
    if (VALUE_FLAGS.includes(flag)) {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw usageError(`${arg} needs a value`);
      rest.push(value);
    }
  }

  return { profile, refresh, help, rest };
}
