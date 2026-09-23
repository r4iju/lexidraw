/**
 * The error vocabulary of `/api/v1`. Every REST error body carries one of
 * these as its `code`, the OpenAPI document enumerates them, and the CLI
 * mirrors them, so a procedure that needs a code outside this map has to
 * widen the map first rather than inventing one at the throw site.
 *
 * The transport contributes codes of its own before any procedure runs —
 * a malformed body, an oversized one, a wrong content type, a method the
 * route does not serve — so those belong here too.
 */
export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  PARSE_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export const API_ERROR_CODES = Object.keys(
  API_ERROR_STATUS,
) as readonly ApiErrorCode[];
