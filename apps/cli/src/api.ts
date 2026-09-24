import { one, parseArgs, type ParsedArgs } from "./args";
import { json, type Context } from "./context";
import { describe, usageError } from "./errors";
import { expectOk, requestApi } from "./http";
import { openSession } from "./session";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

const BODYLESS = ["GET", "HEAD"];

export async function apiCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, { value: ["json", "query"], boolean: [] });
  const [method, path, ...extra] = args.positionals;
  if (method === undefined || path === undefined) {
    throw usageError(
      "usage: lexidraw api <METHOD> <path> [--json <body>|@file] [--query k=v]",
    );
  }
  if (extra.length > 0) {
    throw usageError(`unexpected argument "${extra[0]}"`);
  }

  const verb = method.toUpperCase();
  if (!METHODS.includes(verb)) {
    throw usageError(`unsupported method "${method}"`, { known: METHODS });
  }
  if (BODYLESS.includes(verb) && args.values.json !== undefined) {
    throw usageError(`${verb} does not take a body; drop --json`);
  }

  const response = await requestApi(await openSession(context), {
    method: verb,
    path: restPath(path),
    query: parseQuery(args.values.query ?? []),
    body: await readBody(args),
  });
  context.io.stdout(json(expectOk(response, `${verb} ${path} failed`)));
}

/** Relative to `/api/v1`, and it stays there. */
function restPath(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  if (absolute.split("/").includes("..")) {
    throw usageError(`the path may not contain ".." segments: "${path}"`);
  }
  return absolute;
}

function parseQuery(given: readonly string[]): [string, string][] {
  return given.map((pair) => {
    const equals = pair.indexOf("=");
    if (equals <= 0) {
      throw usageError(`--query expects k=v, got "${pair}"`);
    }
    return [pair.slice(0, equals), pair.slice(equals + 1)];
  });
}

async function readBody(args: ParsedArgs): Promise<unknown> {
  const raw = one(args, "json");
  if (raw === undefined) return undefined;
  const text = raw.startsWith("@") ? await readFile(raw.slice(1)) : raw;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw usageError(`--json is not valid JSON: ${describe(cause)}`);
  }
}

async function readFile(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (cause) {
    throw usageError(`--json @${path} could not be read: ${describe(cause)}`);
  }
}
