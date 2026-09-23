import { CliError, describe } from "./errors";

export const API_PREFIX = "/api/v1";

export type ApiResponse = { status: number; body: unknown };

export type RequestOptions = {
  baseUrl: string;
  method: string;
  path: string;
  token?: string | null;
  query?: readonly (readonly [string, string])[];
  body?: unknown;
};

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

export function apiUrl(options: RequestOptions): string {
  const url = new URL(`${options.baseUrl}${API_PREFIX}${options.path}`);
  for (const [key, value] of options.query ?? []) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

export async function requestApi(
  options: RequestOptions,
): Promise<ApiResponse> {
  const url = apiUrl(options);
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new CliError(
      "NETWORK",
      `${options.method} ${url} did not reach the server: ${describe(cause)}`,
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

/**
 * Re-raises the server's own `{ code, message, issues }` so a REST error and a
 * CLI error read the same, with the status added.
 */
export function expectOk(response: ApiResponse, fallback: string): unknown {
  if (response.status >= 200 && response.status < 300) return response.body;
  const body = (response.body ?? {}) as Record<string, unknown>;
  const code =
    typeof body.code === "string"
      ? body.code
      : (STATUS_CODES[response.status] ?? `HTTP_${response.status}`);
  const message = typeof body.message === "string" ? body.message : fallback;
  return raise(code, message, response.status, body.issues);
}

function raise(
  code: string,
  message: string,
  status: number,
  issues: unknown,
): never {
  throw new CliError(code, message, {
    details: { status, ...(issues === undefined ? {} : { issues }) },
  });
}
