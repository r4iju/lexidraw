import type { Context } from "./context";
import {
  type Entity,
  type EntityKind,
  entityRows,
  listEntities,
} from "./entities";
import { CliError, usageError } from "./errors";
import type { ApiSession } from "./http";

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
};

const BY_NTH = "pass --nth N, or the id";

/** An id is a UUID here, so `--dir <id|path>` needs no second flag. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dirSpec(value: string | undefined): {
  id?: string;
  path?: string;
} {
  if (value === undefined) return {};
  return UUID.test(value) ? { id: value } : { path: value };
}

/** The id a command was aimed at, from either form of address. */
export async function resolveEntity(
  context: Context,
  session: ApiSession,
  target: Target,
): Promise<string> {
  const id = await resolveOptional(context, session, target);
  if (id === null) {
    throw usageError(
      `name the ${target.kind}: its id as an argument, or --path "Dir/Title"`,
    );
  }
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
      hint: target.hint,
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
