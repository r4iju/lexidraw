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
    .map((p) => {
      // Check if paragraph starts with a heading pattern (# 1-6 hashes)
      const headingMatch = p.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const headingText = headingMatch[2] ?? "";
        // Format heading with emphasis, slower rate, and pause
        return `<p><emphasis level="strong"><prosody rate="90%">${escapeXml(headingText)}</prosody></emphasis><break time="500ms"/></p>`;
      }
      // Regular paragraph
      return `<p>${escapeXml(p)}</p>`;
    })
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
