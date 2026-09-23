import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CliError } from "./errors";
import { expectOk, requestApi } from "./http";
import type { Env } from "./context";

/** Long enough to keep a burst of commands off the network, short enough that
 * a deploy is visible without `--refresh`. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

export type OpenApiOperation = {
  operationId?: string;
  parameters?: unknown;
  requestBody?: unknown;
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
  parameters: unknown;
  requestBody: unknown;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function cachePath(profile: string, env: Env): string {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "lexidraw", profile, "openapi.json");
}

export async function loadDocument(options: {
  profile: string;
  baseUrl: string;
  refresh: boolean;
  env: Env;
  now?: number;
}): Promise<OpenApiDocument> {
  const file = cachePath(options.profile, options.env);
  if (!options.refresh) {
    const cached = await readFresh(file, options.now ?? Date.now());
    if (cached) return cached;
  }
  const response = await requestApi({
    baseUrl: options.baseUrl,
    method: "GET",
    path: "/openapi.json",
  });
  const document = expectOk(
    response,
    "fetching the OpenAPI document failed",
  ) as OpenApiDocument;
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, JSON.stringify(document));
  return document;
}

async function readFresh(
  file: string,
  now: number,
): Promise<OpenApiDocument | null> {
  const info = await stat(file).catch(() => null);
  if (!info || now - info.mtimeMs > CACHE_TTL_MS) return null;
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
        parameters: resolveRefs(document, operation.parameters ?? []),
        requestBody: resolveRefs(document, operation.requestBody ?? null),
      };
    }
  }
  throw new CliError(
    "OPERATION_NOT_IN_SCHEMA",
    `"${command}" maps to ${operationId}, which this server's OpenAPI document does not describe`,
    { details: { operationId } },
  );
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
