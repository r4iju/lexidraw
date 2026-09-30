import { integer, one, parseArgs } from "./args";
import type { Context } from "./context";
import { json } from "./context";
import { CliError, usageError } from "./errors";
import { address, ADDRESS, resolveEntity } from "./resolve";
import { openSession } from "./session";
import { callApi } from "./http";
import { refuseBytesToTerminal, writeRender } from "./render";
const VERBS = ["list", "get", "create", "update", "delete", "preview"];
export async function htmlBlockCommand(
  context: Context,
  argv: readonly string[],
) {
  const [verb, ...rest] = argv;
  if (!verb || !VERBS.includes(verb))
    throw usageError(`usage: lexidraw doc block ${VERBS.join("|")}`);
  const mutation = ["create", "update", "delete"].includes(verb);
  const allowed = [
    ...ADDRESS,
    ...(verb !== "list" && verb !== "create" ? ["block-id"] : []),
    ...(mutation ? ["if-unmodified-since"] : []),
    ...(verb === "create" || verb === "update" ? ["file"] : []),
    ...(verb === "create" ? ["at-block"] : []),
    ...(verb === "preview" ? ["revision", "width", "out"] : []),
  ];
  const args = parseArgs(rest, { value: allowed, boolean: [] });
  const expected = one(args, "if-unmodified-since");
  if (mutation && !expected)
    throw usageError(
      "HTML block writes require --if-unmodified-since <iso|latest> from a document read",
    );
  const revision = one(args, "revision");
  if (verb === "preview" && !revision)
    throw usageError(
      "HTML block preview needs --revision <saved-block-revision>",
    );
  const blockId = one(args, "block-id");
  if (verb !== "list" && verb !== "create" && !blockId)
    throw usageError("Choose one HTML block with --block-id <uuid>");
  const target = address(args, "document", mutation ? "write" : "read");
  const session = openSession(context);
  const id = await resolveEntity(context, session, target);
  const base = `/documents/${encodeURIComponent(id)}/html-blocks`;
  const path = blockId ? `${base}/${encodeURIComponent(blockId)}` : base;
  let ifUnmodifiedSince = expected;
  if (expected === "latest") {
    const read = (await callApi(session, { method: "GET", path: base })) as {
      updatedAt?: unknown;
    };
    if (typeof read.updatedAt !== "string")
      throw new CliError(
        "BAD_RESPONSE",
        "The block list has no document updatedAt",
      );
    ifUnmodifiedSince = read.updatedAt;
  }
  let source: unknown;
  if (verb === "create" || verb === "update") {
    const file = one(args, "file");
    if (!file)
      throw usageError("Provide saved block source as --file <source.json|->");
    try {
      source = JSON.parse(
        file === "-" ? await context.io.readAll() : await Bun.file(file).text(),
      );
    } catch {
      throw usageError(
        "Block source must be a readable JSON file with html and description",
      );
    }
  }
  if (verb === "preview") {
    const out = one(args, "out");
    refuseBytesToTerminal(context, out, "HTML block preview");
    const width = one(args, "width");
    const response = (await callApi(session, {
      method: "GET",
      path: `${path}/preview`,
      query: [
        ["revision", revision ?? ""],
        ...(width
          ? [["width", String(integer(args, "width", 320))] as const]
          : []),
      ],
    })) as {
      status?: string;
      data?: string;
      message?: string;
      revision?: string;
    };
    if (response.status !== "ready" || !response.data)
      throw new CliError(
        "RENDER_FAILED",
        response.message ?? "Saved-state preview unavailable",
      );
    return writeRender(
      context,
      {
        format: "png",
        contentType: "image/png",
        encoding: "base64",
        data: response.data,
      },
      out,
      { id, blockId, revision: response.revision },
    );
  }
  const index = one(args, "at-block");
  if (verb === "create" && index === undefined)
    throw usageError("Block insertion needs --at-block <0-based-index>");
  const result = await callApi(session, {
    method:
      verb === "create"
        ? "POST"
        : verb === "update"
          ? "PUT"
          : verb === "delete"
            ? "DELETE"
            : "GET",
    path,
    query:
      verb === "delete"
        ? [["ifUnmodifiedSince", ifUnmodifiedSince ?? ""]]
        : undefined,
    body:
      mutation && verb !== "delete"
        ? {
            ifUnmodifiedSince,
            ...(source !== undefined ? { source } : {}),
            ...(verb === "create"
              ? { atBlockIndex: integer(args, "at-block", 0) }
              : {}),
          }
        : undefined,
  });
  context.io.stdout(json(result));
}
