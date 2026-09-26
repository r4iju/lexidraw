/**
 * The largest file a drawing stores, in decoded bytes. A file travels as a
 * base64 data URL inside a JSON body, every REST path is served by one adapter
 * that reads JSON and nothing else, and the platform refuses a request body
 * over 4.5 MB before it reaches the handler. Base64 adds a third, so 3 MiB is
 * the most that still arrives as a request the server can answer with a reason.
 * A file fills a request body alone, so it travels in one of its own: files
 * are sent one at a time, and never batched with another call.
 */
export const MAX_DRAWING_FILE_BYTES = 3 * 1024 * 1024;

/**
 * How many files one drawing stores, and how many bytes in all. An editor
 * opening the drawing fetches every file it stores, and a render holds the
 * ones it shows in memory at once, so the total is what one open costs:
 * 64 MiB is some twenty files at {@link MAX_DRAWING_FILE_BYTES}, or a few
 * hundred screenshots of the 1440 px an editor scales an image to. 200 files
 * keeps an open to that many fetches and a listing of them to one page of
 * the blob store.
 */
export const DRAWING_FILES_LIMIT = {
  count: 200,
  bytes: 64 * 1024 * 1024,
} as const;
