import {
  type ArgSpec,
  one,
  parseArgs,
  type ParsedArgs,
  rejectExtra,
} from "./args";
import { json, type Context } from "./context";
import { CliError, describe, usageError } from "./errors";
import { callApi } from "./http";
import {
  ADDRESS,
  address,
  PARENT,
  parent,
  resolveEntity,
  resolveOptional,
} from "./resolve";
import { type ApiSession, openSession } from "./session";

const USAGE = `usage:
  lexidraw drawing get <id|--path P> [--nth N]
  lexidraw drawing put <id|--path P> [--nth N] --file <elements.json|-> --if-unmodified-since <iso|latest>
  lexidraw drawing create --title <title> [--dir <id>|--dir-path P] [--file <elements.json|->]
  lexidraw drawing render <id|--path P> [--nth N] [--format svg|png] [--scale 1-4] [--out <file>]

put replaces every element, so it states which revision it replaces: pass the
updatedAt a get returned, or "latest" to read it again immediately before
writing.

render writes the image to --out, or to stdout: the SVG as text, the PNG as
bytes, which it refuses to write to a terminal.`;

const VERBS = ["get", "put", "create", "render"] as const;

const SPECS: Record<(typeof VERBS)[number], ArgSpec> = {
  get: { value: ADDRESS, boolean: [] },
  put: { value: [...ADDRESS, "file", "if-unmodified-since"], boolean: [] },
  create: { value: ["title", "file", ...PARENT], boolean: [] },
  render: { value: [...ADDRESS, "format", "scale", "out"], boolean: [] },
};

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
  const verb = VERBS.find((name) => name === argv[0]);
  if (verb === undefined) throw usageError(USAGE, { known: VERBS });
  const args = parseArgs(argv.slice(1), SPECS[verb]);
  switch (verb) {
    case "get":
      return await get(context, args);
    case "put":
      return await put(context, args);
    case "create":
      return await create(context, args);
    case "render":
      return await render(context, args);
  }
}

async function get(context: Context, args: ParsedArgs): Promise<void> {
  const session = openSession(context);
  const id = await resolveEntity(
    context,
    session,
    address(args, "drawing", "read"),
  );
  context.io.stdout(
    json(await callApi(session, { method: "GET", path: drawingPath(id) })),
  );
}

async function put(context: Context, args: ParsedArgs): Promise<void> {
  // PUT /drawings/{id} answers NOT_FOUND for any other entity type, so an id
  // needs no check of its own here.
  const target = address(args, "drawing", "write");
  const file = one(args, "file");
  if (file === undefined) {
    throw usageError("drawing put needs --file <elements.json|->");
  }
  const since = one(args, "if-unmodified-since");
  if (since === undefined) {
    throw usageError("drawing put needs --if-unmodified-since <iso|latest>");
  }
  const elements = await readElements(context, file);

  const session = openSession(context);
  const id = await resolveEntity(context, session, target);
  const path = drawingPath(id);
  context.io.stdout(
    json(
      await callApi(session, {
        method: "PUT",
        path,
        body: {
          id,
          elements,
          ifUnmodifiedSince:
            since === "latest" ? await readUpdatedAt(session, path) : since,
        },
      }),
    ),
  );
}

async function create(context: Context, args: ParsedArgs): Promise<void> {
  rejectExtra(args, 0);
  const title = one(args, "title");
  if (title === undefined) {
    throw usageError("drawing create needs --title <title>");
  }
  const file = one(args, "file");
  const elements =
    file === undefined ? undefined : await readElements(context, file);

  const session = openSession(context);
  const parentId = await resolveOptional(context, session, {
    ...parent(args),
    kind: "directory",
    access: "write",
  });
  context.io.stdout(
    json(
      await callApi(session, {
        method: "POST",
        path: "/drawings",
        body: {
          title,
          ...(elements === undefined ? {} : { elements }),
          ...(parentId === null ? {} : { parentId }),
        },
      }),
    ),
  );
}

async function render(context: Context, args: ParsedArgs): Promise<void> {
  const target = address(args, "drawing", "read");
  const format = one(args, "format") ?? "svg";
  if (!FORMATS.includes(format)) {
    throw usageError(`--format must be ${FORMATS.join(" or ")}`);
  }
  const out = one(args, "out");
  // Raw PNG bytes down a terminal are noise the shell then has to be reset
  // from, so the caller has to say where they go.
  if (format === "png" && out === undefined && context.io.stdoutIsTty) {
    throw usageError(
      "drawing render --format png writes bytes: give --out <file>, or redirect stdout",
    );
  }
  const scale = one(args, "scale");

  const session = openSession(context);
  const id = await resolveEntity(context, session, target);
  const rendered = (await callApi(session, {
    method: "GET",
    path: `${drawingPath(id)}/render`,
    query: [
      ["format", format],
      ...(scale === undefined ? [] : [["scale", scale] as const]),
    ],
  })) as Render;
  return writeRender(context, rendered, out);
}

function drawingPath(id: string): string {
  return `/drawings/${encodeURIComponent(id)}`;
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
  session: ApiSession,
  path: string,
): Promise<string> {
  const drawing = (await callApi(session, { method: "GET", path })) as {
    updatedAt?: unknown;
  };
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
