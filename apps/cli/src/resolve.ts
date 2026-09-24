import { integer, one, type ParsedArgs, rejectExtra } from "./args";
import type { Context } from "./context";
import {
  type Entity,
  type EntityKind,
  entityRows,
  listEntities,
} from "./entities";
import { CliError, usageError } from "./errors";
import type { ApiSession } from "./session";

/**
 * Reads may guess when a title is not unique; writes may not, so they refuse
 * rather than touch the wrong entity.
 */
export type Access = "read" | "write";

export type Target = {
  /** The id, as the command's positional argument. */
  id?: string;
  /** `--path`, directory titles from the root, then the entity's own title. */
  path?: string;
  kind: EntityKind;
  access: Access;
  /** Which of several equally titled matches to take, 1-based. */
  nth?: number;
  /** What to do about an ambiguous write, where `--nth` is not free. */
  hint?: string;
  /**
   * The same for a directory on the way to the target: `--nth` picks the
   * target, never a directory the path walked through.
   */
  dirHint?: string;
};

const BY_NTH = "pass --nth N, or the id";

/** A directory named by `--dir`/`--dir-path` is addressable by its own id. */
const BY_DIR_ID = "address the directory by id (--dir <id>)";

/** Every verb that addresses one entity takes the same two forms. */
export const ADDRESS = ["path", "nth"];

/** A parent directory, by id or by path, never guessed from one value. */
export const PARENT = ["dir", "dir-path"];

/**
 * The entity a verb's id positional or `--path` names, refused before any
 * input is read or request made when it names none.
 */
export function address(
  args: ParsedArgs,
  kind: Exclude<EntityKind, "directory">,
  access: Access,
): Target {
  rejectExtra(args, 1);
  const target = {
    id: args.positionals[0],
    path: one(args, "path"),
    kind,
    access,
    nth: integer(args, "nth", 1),
    // No verb addressed this way names a directory, so a directory on the way
    // to the entity is only escaped by naming the entity itself.
    dirHint: `address the ${kind} by id`,
  };
  if (target.id === undefined && target.path === undefined) {
    throw unnamed(kind);
  }
  return target;
}

function unnamed(kind: EntityKind): CliError {
  return usageError(
    `name the ${kind}: its id as an argument, or --path "Dir/Title"`,
  );
}

/**
 * The directory a listing or a create is aimed at: `--dir <id>` or
 * `--dir-path "Dir/Sub"`. An entity id is free text, so the flag says which
 * form was meant rather than the value's shape deciding.
 */
export function parent(
  args: ParsedArgs,
): Pick<Target, "id" | "path" | "hint" | "dirHint"> {
  const id = one(args, "dir");
  const path = one(args, "dir-path");
  if (id !== undefined && path !== undefined) {
    throw usageError("--dir takes an id and --dir-path a path; give one");
  }
  if (id !== undefined) return { id };
  if (path === undefined) return {};
  return { path, hint: BY_DIR_ID, dirHint: BY_DIR_ID };
}

/** The id a command was aimed at, from either form of address. */
export async function resolveEntity(
  context: Context,
  session: ApiSession,
  target: Target,
): Promise<string> {
  const id = await resolveOptional(context, session, target);
  if (id === null) throw unnamed(target.kind);
  return id;
}

/** The same, where leaving both out means the root directory. */
export async function resolveOptional(
  context: Context,
  session: ApiSession,
  target: Target,
): Promise<string | null> {
  if (target.id !== undefined && target.path !== undefined) {
    throw usageError("give an id or --path, not both");
  }
  if (target.id !== undefined) {
    if (target.nth !== undefined) {
      throw usageError("--nth chooses between paths; drop it or drop the id");
    }
    return target.id;
  }
  if (target.path === undefined) return null;
  return (await resolvePath(context, session, target.path, target)).id;
}

async function resolvePath(
  context: Context,
  session: ApiSession,
  path: string,
  target: Target,
): Promise<Entity> {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "")) {
    throw usageError(`--path has an empty segment: "${path}"`);
  }
  const title = segments[segments.length - 1] as string;

  let parentId: string | null = null;
  for (const segment of segments.slice(0, -1)) {
    const step = await resolveSegment(context, session, {
      parentId,
      segment,
      kind: "directory",
      access: target.access,
      hint: target.dirHint ?? target.hint,
    });
    parentId = step.id;
  }
  return await resolveSegment(context, session, {
    parentId,
    segment: title,
    kind: target.kind,
    access: target.access,
    nth: target.nth,
    hint: target.hint,
  });
}

type Step = {
  parentId: string | null;
  segment: string;
  kind: EntityKind;
  access: Access;
  nth?: number;
  hint?: string;
};

async function resolveSegment(
  context: Context,
  session: ApiSession,
  step: Step,
): Promise<Entity> {
  const children = entityRows(
    await listEntities(session, {
      parentId: step.parentId,
      entityTypes: [step.kind],
    }),
  );
  return choose(context, matches(children, step.segment), step);
}

/** What a caller needs to tell the matches apart and pick one. */
function candidates(
  found: readonly Entity[],
): { id: string; title: string; updatedAt: string }[] {
  return found.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
  }));
}

/** Exact first, so a title that differs only in case never shadows itself. */
function matches(rows: readonly Entity[], title: string): Entity[] {
  const exact = rows.filter((row) => row.title === title);
  const found =
    exact.length > 0
      ? exact
      : rows.filter((row) => row.title.toLowerCase() === title.toLowerCase());
  return [...found].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function choose(
  context: Context,
  found: readonly Entity[],
  step: Step,
): Entity {
  const where = step.parentId === null ? "the root" : step.parentId;
  if (found.length === 0) {
    throw new CliError(
      "NOT_FOUND",
      `no ${step.kind} titled "${step.segment}" in ${where}`,
      { details: { segment: step.segment, parentId: step.parentId } },
    );
  }

  if (step.nth !== undefined) {
    const picked = found[step.nth - 1];
    if (picked === undefined) {
      throw new CliError(
        "NOT_FOUND",
        `--nth ${step.nth} is past the ${found.length} match(es) for "${step.segment}"`,
        {
          details: {
            segment: step.segment,
            parentId: step.parentId,
            candidates: candidates(found),
          },
        },
      );
    }
    return picked;
  }

  const first = found[0] as Entity;
  if (found.length === 1) return first;
  if (step.access === "write") {
    throw new CliError(
      "AMBIGUOUS_PATH",
      `"${step.segment}" matches ${found.length} entities in ${where}; ${step.hint ?? BY_NTH}`,
      {
        details: {
          segment: step.segment,
          parentId: step.parentId,
          candidates: candidates(found),
        },
      },
    );
  }
  context.io.stderr(
    `warning: "${step.segment}" matches ${found.length} entities (${found
      .map((row) => row.id)
      .join(", ")}); reading ${first.id}, the most recently updated\n`,
  );
  return first;
}
