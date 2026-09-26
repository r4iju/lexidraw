import "server-only";
import env from "@packages/env";

/**
 * Posts `body` to the render worker at `endpoint`, which does nothing for a
 * caller without the secret it shares with this app.
 */
export function askRenderWorker(
  endpoint: string,
  body: unknown,
  {
    signal,
    secret = env.RENDER_WORKER_SECRET,
  }: { signal?: AbortSignal; secret?: string } = {},
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}
