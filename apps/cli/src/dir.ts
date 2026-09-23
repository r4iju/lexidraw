import {
  type ArgSpec,
  integer,
  one,
  parseArgs,
  type ParsedArgs,
  rejectExtra,
} from "./args";
import { type Context, json } from "./context";
import { createEntity, listEntities } from "./entities";
import { usageError } from "./errors";
import { chooseFormat, entityTable, ndjson } from "./format";
import { apiSession } from "./http";
import { dirSpec, resolveOptional } from "./resolve";

const VERBS = ["list", "create"] as const;

const SPECS: Record<(typeof VERBS)[number], ArgSpec> = {
  list: { value: ["path", "nth", "format"], boolean: ["page-all"] },
  create: { value: ["title", "dir"], boolean: [] },
};

export async function dirCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const verb = VERBS.find((name) => name === argv[0]);
  if (verb === undefined) {
    throw usageError(`usage: lexidraw dir ${VERBS.join("|")}`, {
      known: VERBS,
    });
  }
  const args = parseArgs(argv.slice(1), SPECS[verb]);
  return verb === "list"
    ? await list(context, args)
    : await create(context, args);
}

/** Everything in one directory, of every type; the root when unaddressed. */
async function list(context: Context, args: ParsedArgs): Promise<void> {
  rejectExtra(args, 1);
  const pageAll = args.booleans.has("page-all");
  const format = chooseFormat(args, ["json", "table"], "json");
  if (pageAll && format !== "json") {
    throw usageError("--page-all streams NDJSON; drop --format");
  }

  const session = apiSession(context);
  const parentId = await resolveOptional(context, session, {
    id: args.positionals[0],
    path: one(args, "path"),
    kind: "directory",
    access: "read",
    nth: integer(args, "nth", 1),
  });
  const rows = await listEntities(session, { parentId });
  if (pageAll) return context.io.stdout(ndjson(rows));
  context.io.stdout(
    format === "table" ? entityTable(rows, { parent: true }) : json(rows),
  );
}

async function create(context: Context, args: ParsedArgs): Promise<void> {
  rejectExtra(args, 0);
  const title = one(args, "title");
  if (title === undefined) throw usageError("dir create needs --title");

  const session = apiSession(context);
  const parentId = await resolveOptional(context, session, {
    ...dirSpec(one(args, "dir")),
    kind: "directory",
    access: "write",
  });
  const { created } = await createEntity(session, {
    title,
    kind: "directory",
    parentId,
  });
  context.io.stdout(json(created));
}
