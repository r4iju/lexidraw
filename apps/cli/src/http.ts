import { CliError, describe } from "./errors";
import type { ApiSession } from "./session";

export const API_PREFIX = "/api/v1";

export type ApiResponse = { status: number; body: unknown };

export type RequestOptions = {
  method: string;
  path: string;
  query?: readonly (readonly [string, string])[];
  body?: unknown;
};

/** A bare base URL is an anonymous call; only a session carries a token. */
export type Target = string | ApiSession;

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_SUPPORTED",
  409: "CONFLICT",
  422: "UNPROCESSABLE_CONTENT",
  500: "INTERNAL_SERVER_ERROR",
};

export function apiUrl(baseUrl: string, options: RequestOptions): string {
  const url = new URL(`${baseUrl}${API_PREFIX}${options.path}`);
  for (const [key, value] of options.query ?? []) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

export async function requestApi(
  target: Target,
  options: RequestOptions,
): Promise<ApiResponse> {
  const anonymous = typeof target === "string";
  const url = apiUrl(anonymous ? target : target.baseUrl, options);
  const headers: Record<string, string> = { accept: "application/json" };
  if (!anonymous) {
    await target.verify();
    headers.authorization = `Bearer ${target.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      // A redirect would carry the token to a host nobody verified.
      redirect: "manual",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new CliError(
      "NETWORK",
      `${options.method} ${url} did not reach the server: ${describe(cause)}`,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new CliError(
      "REDIRECT",
      `${options.method} ${url} redirected to ${location}; the CLI does not follow redirects`,
      { details: { status: response.status, location } },
    );
  }

  const text = await response.text();
  if (text.trim() === "") return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    throw new CliError("BAD_RESPONSE", `${url} answered with non-JSON`, {
      details: { status: response.status },
    });
  }
}

export async function callApi(
  session: ApiSession,
  options: RequestOptions,
): Promise<unknown> {
  const response = await requestApi(session, options);
  return expectOk(response, `${options.method} ${options.path} failed`);
}

/**
 * Re-raises the server's own `{ code, message, issues, data }` so a REST error
 * and a CLI error read the same, with the status added.
 */
export function expectOk(response: ApiResponse, fallback: string): unknown {
  if (response.status >= 200 && response.status < 300) return response.body;
  const body = (response.body ?? {}) as Record<string, unknown>;
  const code =
    typeof body.code === "string"
      ? body.code
      : (STATUS_CODES[response.status] ?? `HTTP_${response.status}`);
  const message = typeof body.message === "string" ? body.message : fallback;
  return raise(code, message, response.status, body.issues, body.data);
}

function raise(
  code: string,
  message: string,
  status: number,
  issues: unknown,
  data: unknown,
): never {
  throw new CliError(code, message, {
    details: {
      status,
      ...(issues === undefined ? {} : { issues }),
      ...machineReadable(data),
    },
  });
}

/** What a caller cannot act on: a stack, and a `zodError` that `issues`
 * already says in the form the CLI prints. */
const DROPPED = ["stack", "zodError"];

/**
 * The server's `data`, keeping what this error actually carries: null is how
 * it marks a field that does not apply.
 */
function machineReadable(data: unknown): { data?: Record<string, unknown> } {
  if (data === null || typeof data !== "object") return {};
  const kept = Object.entries(data as Record<string, unknown>).filter(
    ([key, value]) =>
      !DROPPED.includes(key) && value !== null && value !== undefined,
  );
  return kept.length === 0 ? {} : { data: Object.fromEntries(kept) };
}
