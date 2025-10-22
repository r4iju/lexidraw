// Utility to convert sanitized HTML into readable plain text suitable for TTS
// Mirrors the logic previously embedded in extract-article.ts

export function htmlToPlainText(html: string): string {
  // Replace common block-level closing tags with newlines and normalize breaks
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>(?=\s*\n?)/gi, "\n");
  // Strip all remaining tags
  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  // Normalize whitespace
  return noTags
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\t\u00A0]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
