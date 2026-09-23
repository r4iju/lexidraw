import { one, parseArgs, rejectExtra } from "./args";
import { json, type Context } from "./context";
import { describe, usageError } from "./errors";
import { expectOk, requestApi } from "./http";
import { requireToken } from "./tokens";

const USAGE = `usage:
  lexidraw drawing get <id>
  lexidraw drawing put <id> --file <elements.json|-> --if-unmodified-since <iso|latest>
  lexidraw drawing create --title <title> [--file <elements.json|->] [--parent <id>]

put replaces every element, so it states which revision it replaces: pass the
updatedAt a get returned, or "latest" to read it again immediately before
writing.`;

const FLAGS = {
  value: ["file", "title", "parent", "if-unmodified-since"],
  boolean: [],
} as const;

export async function drawingCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, FLAGS);
  const [verb, id] = args.positionals;
  const { token } = requireToken(
    context.profile,
    context.io.env,
    context.io.tokens,
  );
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await requestApi({
      baseUrl: context.profile.baseUrl,
      method,
      path,
      token,
      body,
    });
    return expectOk(response, `${method} ${path} failed`);
  };
  const call = async (method: string, path: string, body?: unknown) => {
    context.io.stdout(json(await request(method, path, body)));
  };

  switch (verb) {
    case "get": {
      rejectExtra(args, 2);
      if (id === undefined) throw usageError(USAGE);
      return call("GET", `/drawings/${encodeURIComponent(id)}`);
    }
    case "put": {
      rejectExtra(args, 2);
      if (id === undefined) throw usageError(USAGE);
      const file = one(args, "file");
      if (file === undefined) {
        throw usageError("drawing put needs --file <elements.json|->");
      }
      const since = one(args, "if-unmodified-since");
      if (since === undefined) {
        throw usageError(
          "drawing put needs --if-unmodified-since <iso|latest>",
        );
      }
      const path = `/drawings/${encodeURIComponent(id)}`;
      const elements = await readElements(context, file);
      return call("PUT", path, {
        id,
        elements,
        ifUnmodifiedSince:
          since === "latest" ? await readUpdatedAt(request, path) : since,
      });
    }
    case "create": {
      rejectExtra(args, 1);
      const title = one(args, "title");
      if (title === undefined) {
        throw usageError("drawing create needs --title <title>");
      }
      const file = one(args, "file");
      const parentId = one(args, "parent");
      return call("POST", "/drawings", {
        title,
        ...(file === undefined
          ? {}
          : { elements: await readElements(context, file) }),
        ...(parentId === undefined ? {} : { parentId }),
      });
    }
    default:
      throw usageError(USAGE);
  }
}

/**
 * The revision to replace, read now. "latest" says the caller has nothing to
 * compare against and accepts whatever is stored this second; a save that
 * lands between this read and the write is still refused by the server.
 */
async function readUpdatedAt(
  request: (method: string, path: string) => Promise<unknown>,
  path: string,
): Promise<string> {
  const drawing = (await request("GET", path)) as { updatedAt?: unknown };
  if (typeof drawing.updatedAt !== "string") {
    throw usageError(`${path} did not answer with an updatedAt to replace`);
  }
  return drawing.updatedAt;
}

/** The elements to write, from a file or, as `-`, from standard input. */
async function readElements(
  context: Context,
  file: string,
): Promise<unknown[]> {
  const text = file === "-" ? await context.io.readAll() : await readFile(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw usageError(`--file is not valid JSON: ${describe(cause)}`);
  }
  if (!Array.isArray(parsed)) {
    throw usageError("--file must hold a JSON array of elements");
  }
  return parsed;
}

async function readFile(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (cause) {
    throw usageError(`--file ${path} could not be read: ${describe(cause)}`);
  }
}
