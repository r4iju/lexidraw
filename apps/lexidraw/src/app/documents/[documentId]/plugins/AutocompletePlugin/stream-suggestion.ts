export type SuggestionRequest = {
  title: string;
  before: string;
  after: string;
  entityId?: string;
};

/**
 * Streams the model's raw reply, calling `onText` with all of it so far, and
 * resolves to the whole reply; to "" when autocomplete is off or failed.
 */
export async function streamSuggestion(
  request: SuggestionRequest,
  signal: AbortSignal,
  onText: (raw: string) => void,
): Promise<string> {
  const response = await fetch("/api/autocomplete/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body || response.status === 204) {
    if (!response.ok) {
      console.warn("[autocomplete]", response.status, await response.text());
    }
    return "";
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let raw = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return raw;
    raw += value;
    onText(raw);
  }
}
