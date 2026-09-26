/** The store API version the installed @vercel/blob speaks. */
const BLOB_API_VERSION = "12";

/**
 * The request @vercel/blob/client's `put` makes to store `pathname` with a
 * client `token`, for a client that doesn't have the library.
 */
export function blobUploadRequest(
  pathname: string,
  token: string,
  contentType: string,
) {
  const api = process.env.VERCEL_BLOB_API_URL ?? "https://vercel.com/api/blob";
  const [, , , storeId = ""] = token.split("_");
  return {
    method: "PUT" as const,
    url: `${api}/?${new URLSearchParams({ pathname })}`,
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-store-id": storeId,
      "x-vercel-blob-access": "public",
      "x-content-type": contentType,
    },
  };
}
