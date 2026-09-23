import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Env } from "./env";
import { CliError } from "./errors";
import { expectOk, requestApi } from "./http";
import { originKey, type Profile } from "./profile";

/**
 * Long enough to keep a burst of commands off the network, short enough that a
 * deploy is visible without `--refresh`.
 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

export type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
};

export type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: unknown;
};

export type CommandSchema = {
  command: string;
  method: string;
  path: string;
  operationId: string;
  summary: string | null;
  parameters: unknown;
  requestBody: unknown;
  response: unknown;
};

type LoadOptions = {
  profile: Profile;
  refresh: boolean;
  env: Env;
  now?: number;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Keyed by origin as well as profile: `LEXIDRAW_URL` changes which server a
 * profile describes, and two servers do not share a schema. */
export function cachePath(profile: Profile, env: Env): string {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(
    base,
    "lexidraw",
    profile.name,
    originKey(profile.origin),
    "openapi.json",
  );
}

export async function loadDocument(
  options: LoadOptions,
): Promise<{ document: OpenApiDocument; cached: boolean }> {
  const file = cachePath(options.profile, options.env);
  if (!options.refresh) {
    const cached = await readFresh(file, options.now ?? Date.now());
    if (cached) return { document: cached, cached: true };
  }
  const response = await requestApi({
    baseUrl: options.profile.baseUrl,
    method: "GET",
    path: "/openapi.json",
  });
  const document = expectOk(
    response,
    "fetching the OpenAPI document failed",
  ) as OpenApiDocument;
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, JSON.stringify(document));
  return { document, cached: false };
}

/** The schema for one command, refetching once when only the cache disagrees. */
export async function operationSchema(
  options: LoadOptions & { command: string; operationId: string },
): Promise<CommandSchema> {
  const { command, operationId } = options;
  const first = await loadDocument(options);
  try {
    return extractOperation(first.document, operationId, command);
  } catch (error) {
    const stale =
      first.cached &&
      error instanceof CliError &&
      error.code === "OPERATION_NOT_IN_SCHEMA";
    if (!stale) throw error;
    const fresh = await loadDocument({ ...options, refresh: true });
    return extractOperation(fresh.document, operationId, command);
  }
}

async function readFresh(
  file: string,
  now: number,
): Promise<OpenApiDocument | null> {
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  // A negative age means the clock moved; trust the network over the file.
  const age = now - info.mtimeMs;
  if (age < 0 || age > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(await Bun.file(file).text()) as OpenApiDocument;
  } catch {
    return null;
  }
}

export function extractOperation(
  document: OpenApiDocument,
  operationId: string,
  command: string,
): CommandSchema {
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = methods[method];
      if (operation?.operationId !== operationId) continue;
      return {
        command,
        method: method.toUpperCase(),
        path,
        operationId,
        summary: operation.summary ?? null,
        parameters: resolveRefs(document, operation.parameters ?? []),
        requestBody: resolveRefs(document, operation.requestBody ?? null),
        response: resolveRefs(document, successSchema(operation) ?? null),
      };
    }
  }
  throw new CliError(
    "OPERATION_NOT_IN_SCHEMA",
    `"${command}" maps to ${operationId}, which this server's OpenAPI document does not describe; try --refresh`,
    { details: { operationId } },
  );
}

function successSchema(operation: OpenApiOperation): unknown {
  const ok = operation.responses?.["200"] as
    | { content?: Record<string, { schema?: unknown }> }
    | undefined;
  return ok?.content?.["application/json"]?.schema;
}

/** Inlines `#/...` references so the printed schema stands on its own. */
function resolveRefs(
  document: OpenApiDocument,
  node: unknown,
  seen: readonly string[] = [],
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(document, item, seen));
  }
  if (node === null || typeof node !== "object") return node;

  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === "string") {
    // A reference back to an ancestor stays a reference; inlining it would not
    // terminate.
    if (seen.includes(ref)) return node;
    const target = follow(document, ref);
    if (target === undefined) return node;
    return resolveRefs(document, target, [...seen, ref]);
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      resolveRefs(document, value, seen),
    ]),
  );
}

function follow(document: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = document;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}
