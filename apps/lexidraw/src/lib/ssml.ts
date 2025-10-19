import "server-only";

type SsmlOptions = {
  languageCode?: string;
  paragraphBreakMs?: number;
  rate?: number; // 0.85..1.2
};

export function buildSsmlFromParagraphs(
  text: string,
  opts: SsmlOptions = {},
): string {
  const paragraphs = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const lang = opts.languageCode ?? "en-US";
  const breakMs = Math.max(0, Math.min(5000, opts.paragraphBreakMs ?? 300));
  const rate = opts.rate ? Math.max(0.5, Math.min(2, opts.rate)) : undefined;
  const prosodyOpen = rate ? `<prosody rate="${Math.round(rate * 100)}%">` : "";
  const prosodyClose = rate ? "</prosody>" : "";

  const body = paragraphs
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join(`<break time="${breakMs}ms"/>`);

  return `<speak xml:lang="${lang}">${prosodyOpen}${body}${prosodyClose}</speak>`;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
