import "server-only";

/**
 * What a speech provider's refusal says in a job's error, which its reader
 * sees: the status, and the provider's own code for the reason. The body can
 * quote the request's credentials (OpenAI echoes part of a key it refuses),
 * so it goes to the server's log alone.
 */
export async function refusal(provider: string, res: Response) {
  const text = await res.text();
  console.warn(`[tts][${provider.toLowerCase()}] refused`, {
    status: res.status,
    statusText: res.statusText,
    body: text.slice(0, 500),
  });
  const status = [res.status, res.statusText].filter(Boolean).join(" ");
  return `${provider} TTS error: ${status}${reasonIn(text)}`;
}

/** The reason code in an OpenAI, Google or Kokoro-FastAPI error. */
function reasonIn(text: string) {
  try {
    const body = JSON.parse(text) as {
      error?: { code?: unknown; status?: unknown; type?: unknown };
      detail?: unknown;
    };
    const reason = [
      body.error?.code,
      body.error?.status,
      body.error?.type,
      // Kokoro-FastAPI: { detail: { error: "validation_error", message } },
      // or FastAPI's own detail string.
      (body.detail as { error?: unknown } | undefined)?.error,
      body.detail,
    ].find((value) => typeof value === "string");
    return reason ? ` (${String(reason).slice(0, 200)})` : "";
  } catch {
    return "";
  }
}
