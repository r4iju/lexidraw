import { one, parseArgs, rejectExtra } from "./args";
import { json, type Context } from "./context";
import { CliError, describe, usageError } from "./errors";
import { expectOk, requestApi } from "./http";
import { openSession } from "./session";

const USAGE = `usage:
  lexidraw drawing get <id>
  lexidraw drawing put <id> --file <elements.json|-> --if-unmodified-since <iso|latest>
  lexidraw drawing create --title <title> [--file <elements.json|->] [--parent <id>]
  lexidraw drawing render <id> [--format svg|png] [--scale 1-4] [--out <file>]

put replaces every element, so it states which revision it replaces: pass the
updatedAt a get returned, or "latest" to read it again immediately before
writing.

render writes the image to --out, or to stdout: the SVG as text, the PNG as
bytes, which it refuses to write to a terminal.`;

const FLAGS = {
  value: [
    "file",
    "title",
    "parent",
    "if-unmodified-since",
    "format",
    "out",
    "scale",
  ],
  boolean: [],
} as const;

const FORMATS = ["svg", "png"];

/** The render envelope, as the OpenAPI document declares it. */
type Render = {
  format: string;
  contentType: string;
  encoding: string;
  width: number;
  height: number;
  data: string;
};

export async function drawingCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, FLAGS);
  const [verb, id] = args.positionals;
  const session = openSession(context);
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    query?: readonly (readonly [string, string])[],
  ) => {
    const response = await requestApi(session, {
      method,
      path,
      body,
      query,
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
    case "render": {
      rejectExtra(args, 2);
      if (id === undefined) throw usageError(USAGE);
      const format = one(args, "format") ?? "svg";
      if (!FORMATS.includes(format)) {
        throw usageError(`--format must be ${FORMATS.join(" or ")}`);
      }
      const out = one(args, "out");
      // Raw PNG bytes down a terminal are noise the shell then has to be
      // reset from, so the caller has to say where they go.
      if (format === "png" && out === undefined && context.io.stdoutIsTty) {
        throw usageError(
          "drawing render --format png writes bytes: give --out <file>, or redirect stdout",
        );
      }
      const scale = one(args, "scale");
      const rendered = (await request(
        "GET",
        `/drawings/${encodeURIComponent(id)}/render`,
        undefined,
        [
          ["format", format],
          ...(scale === undefined ? [] : [["scale", scale] as const]),
        ],
      )) as Render;
      return writeRender(context, rendered, out);
    }
    default:
      throw usageError(USAGE);
  }
}

/**
 * The image, decoded from the envelope the REST path answers with. A PNG
 * arrives base64 encoded because that path is JSON only; see the procedure's
 * description in the OpenAPI document.
 */
async function writeRender(
  context: Context,
  rendered: Render,
  out: string | undefined,
): Promise<void> {
  if (typeof rendered.data !== "string") {
    throw new CliError("BAD_RESPONSE", "the render carried no data");
  }
  const image =
    rendered.encoding === "base64"
      ? Buffer.from(rendered.data, "base64")
      : rendered.data;
  if (out === undefined) {
    if (typeof image === "string") return context.io.stdout(image);
    return context.io.stdoutBytes(image);
  }
  try {
    await Bun.write(out, image);
  } catch (cause) {
    throw new CliError(
      "WRITE_FAILED",
      `--out ${out} could not be written: ${describe(cause)}`,
    );
  }
  context.io.stdout(
    json({
      format: rendered.format,
      contentType: rendered.contentType,
      width: rendered.width,
      height: rendered.height,
      // What the file holds, not what the string counts: an SVG's characters
      // are UTF-16 units here and UTF-8 bytes on disk.
      bytes: Buffer.byteLength(image),
      out,
    }),
  );
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
