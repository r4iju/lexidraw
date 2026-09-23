import { apiCommand } from "./api";
import { drawingCommand } from "./drawing";
import { authLogin, authStatus } from "./auth";
import type { Context, Io } from "./context";
import { dirCommand } from "./dir";
import { docCommand } from "./doc";
import { exitCodeOf, formatError, usageError } from "./errors";
import { PROFILES, resolveProfile } from "./profile";
import { schemaCommand } from "./schema";
import { searchCommand } from "./search";

const TOP_LEVEL = ["api", "auth", "dir", "doc", "drawing", "schema", "search"];

/** Flags whose value must not be mistaken for a global flag while scanning. */
const VALUE_FLAGS = [
  "profile",
  "token",
  "json",
  "query",
  "path",
  "dir",
  "dir-path",
  "title",
  "file",
  "text",
  "format",
  "nth",
  "after-heading",
  "at-block",
  "parent",
  "if-unmodified-since",
  "format",
  "out",
  "scale",
];

const USAGE = `lexidraw — Lexidraw from the terminal

Usage:
  lexidraw doc list [--dir <id>|--dir-path P] [--format json|table] [--page-all]
  lexidraw doc get <id|--path P> [--format md|raw|json]
  lexidraw doc create --title T [--dir <id>|--dir-path P] [--file f|--text s]
                      (a body replaces the new document's empty paragraph)
  lexidraw doc append <id|--path P> (--file f|--text s) [--if-unmodified-since W]
  lexidraw doc insert <id|--path P> (--file f|--text s)
                      (--after-heading H [--nth N] | --at-block N)
                      --if-unmodified-since W
  lexidraw doc put <id|--path P> --replace (--file f|--text s)
                   --if-unmodified-since W
  lexidraw doc delete <id|--path P>
  lexidraw dir list [<id>|--path P] [--format json|table] [--page-all]
  lexidraw dir create --title T [--dir <id>|--dir-path P]
  lexidraw search <query> [--format json|table]
  lexidraw auth login [--token lxd_...]
  lexidraw auth status
  lexidraw api <METHOD> <path> [--json <body>|@file] [--query k=v ...]
  lexidraw drawing get <id>
  lexidraw drawing put <id> --file <elements.json|-> --if-unmodified-since <iso|latest>
  lexidraw drawing create --title <title> [--file <elements.json|->] [--parent <id>]
  lexidraw drawing render <id> [--format svg|png] [--scale 1-4] [--out <file>]
  lexidraw schema <command> | lexidraw schema --list

Addressing:
  An entity is its id, or --path "Dir/Sub/Title" walked through directory
  titles from the root; a parent directory is --dir <id> or --dir-path
  "Dir/Sub", never guessed from the value's shape. Several matches: a read
  takes the most recently updated and says so on stderr, a write fails with
  the candidates. --nth N picks one, counting from the most recent, among the
  matches for the last segment of --path. --file - reads stdin.

  A path splits on "/" with no escape, so a title containing "/" is only
  addressable by id, and the "path" a "doc get" prints in its frontmatter is
  a display label rather than something to feed back to --path.

Preconditions:
  --if-unmodified-since <iso> is the updatedAt the write expects to find;
  "latest" reads the document first and uses what it finds, which is two
  calls and still racy, only explicitly so.

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

Output is JSON on stdout, except for a render, which is the image itself;
errors are a JSON object on stderr with a stable \`code\` and a non-zero exit.
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
    case "doc":
      await docCommand(context, tail);
      return 0;
    case "dir":
      await dirCommand(context, tail);
      return 0;
    case "search":
      await searchCommand(context, tail);
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
