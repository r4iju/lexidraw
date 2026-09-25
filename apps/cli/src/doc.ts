import {
  type ArgSpec,
  integer,
  one,
  parseArgs,
  type ParsedArgs,
  rejectExtra,
} from "./args";
import { type Context, json } from "./context";
import { deleteEntity } from "./delete";
import { createEntity, listEntities } from "./entities";
import { CliError, describe, usageError } from "./errors";
import { chooseFormat, entityTable, ndjson, rejectFormat } from "./format";
import { callApi } from "./http";
import { type Rendered, refuseBytesToTerminal, writeRender } from "./render";
import { type ApiSession, openSession } from "./session";
import {
  ADDRESS,
  address,
  PARENT,
  parent,
  resolveEntity,
  resolveOptional,
} from "./resolve";

const VERBS = [
  "list",
  "get",
  "create",
  "append",
  "insert",
  "put",
  "render",
  "delete",
] as const;

const SPECS: Record<(typeof VERBS)[number], ArgSpec> = {
  list: { value: [...PARENT, "format"], boolean: ["page-all"] },
  get: { value: [...ADDRESS, "format"], boolean: [] },
  create: { value: ["title", ...PARENT, "file", "text"], boolean: [] },
  append: {
    value: [...ADDRESS, "file", "text", "if-unmodified-since"],
    boolean: [],
  },
  insert: {
    value: [
      "path",
      "file",
      "text",
      "after-heading",
      "nth",
      "at-block",
      "if-unmodified-since",
    ],
    boolean: [],
  },
  put: {
    value: [...ADDRESS, "file", "text", "if-unmodified-since"],
    boolean: ["replace"],
  },
  render: {
    value: [
      ...ADDRESS,
      "format",
      "paper",
      "orientation",
      "width",
      "theme",
      "out",
    ],
    boolean: ["touch"],
  },
  delete: { value: ADDRESS, boolean: [] },
};

const RENDER_FORMATS = ["png", "pdf"];
const PAPER_SIZES = ["A4", "Letter"];
const ORIENTATIONS = ["portrait", "landscape"];

export async function docCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const verb = VERBS.find((name) => name === argv[0]);
  if (verb === undefined) {
    throw usageError(`usage: lexidraw doc ${VERBS.join("|")}`, {
      known: VERBS,
    });
  }
  const args = parseArgs(argv.slice(1), SPECS[verb]);
  switch (verb) {
    case "list":
      return await list(context, args);
    case "get":
      return await get(context, args);
    case "create":
      return await create(context, args);
    case "append":
      return await append(context, args);
    case "insert":
      return await insert(context, args);
    case "put":
      return await put(context, args);
    case "render":
      return await render(context, args);
    case "delete":
      return await deleteEntity(context, args, "document");
  }
}

async function list(context: Context, args: ParsedArgs): Promise<void> {
  rejectExtra(args, 0);
  const pageAll = args.booleans.has("page-all");
  const format = chooseFormat(args, ["json", "table"], "json");
  if (pageAll) rejectFormat(args, "--page-all streams NDJSON; drop --format");

  const session = openSession(context);
  const parentId = await resolveOptional(context, session, {
    ...parent(args),
    kind: "directory",
    access: "read",
  });
  const rows = await listEntities(session, {
    parentId,
    entityTypes: ["document"],
  });
  if (pageAll) return context.io.stdout(ndjson(rows));
  context.io.stdout(format === "table" ? entityTable(rows) : json(rows));
}

async function get(context: Context, args: ParsedArgs): Promise<void> {
  const format = chooseFormat(args, ["md", "raw", "json"], "md");
  const session = openSession(context);
  const id = await resolveEntity(
    context,
    session,
    address(args, "document", "read"),
  );
  const body = await callApi(session, {
    method: "GET",
    path: markdownPath(id),
    query: [["format", format === "md" ? "markdown" : format]],
  });
  if (format === "json") return context.io.stdout(json(body));

  const { content, losses } = body as { content?: unknown; losses?: unknown };
  if (typeof content !== "string") {
    throw new CliError("BAD_RESPONSE", "the document came back without text");
  }
  context.io.stdout(content.endsWith("\n") ? content : `${content}\n`);
  // Beside the markdown rather than in it, so the output still writes back
  // as it is.
  if (Array.isArray(losses)) {
    for (const loss of losses) context.io.stderr(`note: ${loss}\n`);
  }
}

async function create(context: Context, args: ParsedArgs): Promise<void> {
  rejectExtra(args, 0);
  const wanted =
    args.values.file !== undefined || args.values.text !== undefined;
  // Without --title the server names the document from the body's front
  // matter or leading `# X`, which it does for an untitled document.
  const title = one(args, "title") ?? (wanted ? "Untitled" : undefined);
  if (title === undefined)
    throw usageError("doc create needs --title, or a body to take it from");
  const markdown = wanted ? await body(context, args) : null;

  const session = openSession(context);
  const parentId = await resolveOptional(context, session, {
    ...parent(args),
    kind: "directory",
    access: "write",
  });
  const { id, created } = await createEntity(session, {
    title,
    kind: "document",
    parentId,
  });
  if (markdown === null) return context.io.stdout(json(created));

  // The body replaces the empty paragraph the new document was given, rather
  // than following it, and the create's own revision is the precondition, so
  // nothing can have slipped in between. The `updatedAt` a caller needs for
  // its next write is that write's, not the empty document's.
  const written = await withCreatedId(id, () =>
    callApi(session, {
      method: "PUT",
      path: markdownPath(id),
      body: { markdown, ifUnmodifiedSince: revisionOf(created) },
    }),
  );
  const {
    title: writtenTitle,
    updatedAt,
    notes,
  } = written as {
    title?: unknown;
    updatedAt?: unknown;
    notes?: unknown;
  };
  context.io.stdout(
    json({
      ...created,
      ...(typeof writtenTitle === "string" ? { title: writtenTitle } : {}),
      updatedAt,
      notes,
    }),
  );
}

async function append(context: Context, args: ParsedArgs): Promise<void> {
  const markdown = await body(context, args);
  const session = openSession(context);
  const id = await resolveEntity(
    context,
    session,
    address(args, "document", "write"),
  );
  const since = await precondition(
    session,
    id,
    one(args, "if-unmodified-since"),
  );
  context.io.stdout(
    json(
      await callApi(session, {
        method: "POST",
        path: `${markdownPath(id)}/append`,
        body: { markdown, ...since },
      }),
    ),
  );
}

async function insert(context: Context, args: ParsedArgs): Promise<void> {
  const markdown = await body(context, args);
  const afterHeading = one(args, "after-heading");
  const atBlock = integer(args, "at-block", 0);
  if ((afterHeading === undefined) === (atBlock === undefined)) {
    throw usageError(
      'doc insert needs one place to write: --after-heading "H" or --at-block N',
    );
  }
  const where =
    afterHeading === undefined
      ? { atBlockIndex: atBlock }
      : { afterHeading, ...optionalNth(integer(args, "nth", 1)) };
  const given = required(args, "if-unmodified-since", "doc insert");

  const session = openSession(context);
  // `--nth` picks the heading here, so an ambiguous path has only the id left.
  const id = await resolveEntity(context, session, {
    ...address(args, "document", "write"),
    nth: undefined,
    hint: "address it by id (--nth picks the heading here)",
  });
  const since = await precondition(session, id, given);
  context.io.stdout(
    json(
      await callApi(session, {
        method: "POST",
        path: `${markdownPath(id)}/insert`,
        body: { markdown, ...where, ...since },
      }),
    ),
  );
}

async function put(context: Context, args: ParsedArgs): Promise<void> {
  if (!args.booleans.has("replace")) {
    throw usageError(
      "doc put replaces the whole document and keeps nothing; pass --replace to say so",
    );
  }
  const markdown = await body(context, args);
  const given = required(args, "if-unmodified-since", "doc put");

  const session = openSession(context);
  const id = await resolveEntity(
    context,
    session,
    address(args, "document", "write"),
  );
  const since = await precondition(session, id, given);
  context.io.stdout(
    json(
      await callApi(session, {
        method: "PUT",
        path: markdownPath(id),
        body: { markdown, ...since },
      }),
    ),
  );
}

/**
 * A failure after the entity exists names it, so the caller can finish the
 * write or delete what it left behind.
 */
async function withCreatedId<T>(
  id: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    const error =
      cause instanceof CliError
        ? cause
        : new CliError("INTERNAL", describe(cause));
    const said = `${error.message}; the document ${id} was created and is empty`;
    throw new CliError(error.code, said, {
      exitCode: error.exitCode,
      details: { ...error.details, createdId: id },
    });
  }
}

function revisionOf(created: Record<string, unknown>): string {
  const updatedAt = created.updatedAt;
  if (typeof updatedAt !== "string") {
    throw new CliError(
      "BAD_RESPONSE",
      "the new document came back without an updatedAt to write against",
    );
  }
  return updatedAt;
}

async function render(context: Context, args: ParsedArgs): Promise<void> {
  const target = address(args, "document", "read");
  const format = one(args, "format") ?? "png";
  if (!RENDER_FORMATS.includes(format)) {
    throw usageError(`doc render needs --format ${RENDER_FORMATS.join("|")}`);
  }
  const width = one(args, "width");
  if (
    width !== undefined &&
    (!Number.isInteger(Number(width)) ||
      Number(width) < 320 ||
      Number(width) > 4096)
  )
    throw usageError("--width must be an integer between 320 and 4096");
  const theme = choice(args, "theme", ["light", "dark"]);
  const paper = choice(args, "paper", PAPER_SIZES);
  const orientation = choice(args, "orientation", ORIENTATIONS);
  const out = one(args, "out");
  refuseBytesToTerminal(context, out, `doc render --format ${format}`);

  const session = openSession(context);
  const id = await resolveEntity(context, session, target);
  const rendered = (await callApi(session, {
    method: "GET",
    path: `/documents/${encodeURIComponent(id)}/render`,
    query: [
      ["format", format],
      ...(width === undefined ? [] : [["width", width] as const]),
      ...(theme === undefined ? [] : [["theme", theme] as const]),
      ...(args.booleans.has("touch") ? [["touch", "true"] as const] : []),
      ...(paper === undefined ? [] : [["paper", paper] as const]),
      ...(orientation === undefined
        ? []
        : [["orientation", orientation] as const]),
    ],
  })) as Rendered & { id: string };
  return writeRender(context, rendered, out, {
    id: rendered.id,
    format: rendered.format,
    contentType: rendered.contentType,
  });
}

/** A flag's value, when given, which must be one of `allowed`. */
function choice(
  args: ParsedArgs,
  name: string,
  allowed: readonly string[],
): string | undefined {
  const value = one(args, name);
  if (value !== undefined && !allowed.includes(value)) {
    throw usageError(`--${name} must be ${allowed.join(" or ")}`);
  }
  return value;
}

function markdownPath(id: string): string {
  return `/documents/${encodeURIComponent(id)}/markdown`;
}

/** The markdown to write, from a file, from stdin as `-`, or inline. */
async function body(context: Context, args: ParsedArgs): Promise<string> {
  const file = one(args, "file");
  const text = one(args, "text");
  if (file !== undefined && text !== undefined) {
    throw usageError("--file and --text are both given; pick one");
  }
  if (text !== undefined) return nonBlank(text, "--text");
  if (file === undefined) {
    throw usageError(
      'the markdown is missing: pass --file <path> or --text "..."',
    );
  }
  if (file === "-") return nonBlank(await context.io.readAll(), "stdin");
  try {
    return nonBlank(await Bun.file(file).text(), `--file ${file}`);
  } catch (cause) {
    if (cause instanceof CliError) throw cause;
    throw usageError(`--file ${file} could not be read: ${describe(cause)}`);
  }
}

/** Every write path rejects blank markdown, so the round trip is skipped. */
function nonBlank(markdown: string, source: string): string {
  if (markdown.trim() === "") {
    throw usageError(`${source} is blank; a write needs markdown`);
  }
  return markdown;
}

/**
 * `latest` reads the document and writes against what it found: two calls,
 * still racy, but the race is stated rather than skipped.
 */
async function precondition(
  session: ApiSession,
  id: string,
  given: string | undefined,
): Promise<{ ifUnmodifiedSince?: string }> {
  if (given === undefined) return {};
  if (given !== "latest") return { ifUnmodifiedSince: given };
  const read = await callApi(session, {
    method: "GET",
    path: markdownPath(id),
    query: [["format", "raw"]],
  });
  const updatedAt = (read as { updatedAt?: unknown }).updatedAt;
  if (typeof updatedAt !== "string") {
    throw new CliError(
      "BAD_RESPONSE",
      "the document came back without an updatedAt to write against",
    );
  }
  return { ifUnmodifiedSince: updatedAt };
}

function required(args: ParsedArgs, name: string, command: string): string {
  const given = one(args, name);
  if (given === undefined) {
    throw usageError(
      `${command} overwrites what is there, so it needs --${name} <iso|latest>: the updatedAt it expects to find`,
    );
  }
  return given;
}

function optionalNth(nth: number | undefined): { nth?: number } {
  return nth === undefined ? {} : { nth };
}
