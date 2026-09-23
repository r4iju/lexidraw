/**
 * The error vocabulary of `/api/v1`. Every REST error body carries one of
 * these as its `code`, the OpenAPI document enumerates them, and the CLI
 * mirrors them, so a procedure that needs a code outside this map has to
 * widen the map first rather than inventing one at the throw site.
 */
export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export const API_ERROR_CODES = Object.keys(
  API_ERROR_STATUS,
) as readonly ApiErrorCode[];
