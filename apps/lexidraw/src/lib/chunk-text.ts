import "server-only";

export type TextChunk = {
  index: number;
  text: string;
  heading?: string;
};

type ChunkOptions = {
  targetSize?: number; // preferred size in characters
  hardCap?: number; // maximum size in characters
};

export function chunkTextByParagraphs(
  input: string,
  opts: ChunkOptions = {},
): TextChunk[] {
  const targetSize = Math.max(200, Math.min(2000, opts.targetSize ?? 1400));
  const hardCap = Math.max(targetSize, opts.hardCap ?? 4000);

  const paragraphs = input
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let buffer: string[] = [];
  let size = 0;
  let index = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({ index: index++, text: buffer.join("\n\n") });
    buffer = [];
    size = 0;
  };

  for (const p of paragraphs) {
    const paragraph = p.trim();
    if (!paragraph) continue;
    const nextSize = size + (size > 0 ? 2 : 0) + paragraph.length;
    if (nextSize > targetSize) {
      if (size === 0 && paragraph.length > hardCap) {
        // break the single huge paragraph at sentence boundaries
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let sentenceBuf: string[] = [];
        let sentenceSize = 0;
        for (const s of sentences) {
          const nextSentenceSize =
            sentenceSize + (sentenceSize > 0 ? 1 : 0) + s.length;
          if (nextSentenceSize > hardCap) {
            if (sentenceBuf.length) {
              chunks.push({ index: index++, text: sentenceBuf.join(" ") });
              sentenceBuf = [];
              sentenceSize = 0;
            }
            chunks.push({ index: index++, text: s });
          } else {
            sentenceBuf.push(s);
            sentenceSize = nextSentenceSize;
          }
        }
        if (sentenceBuf.length) {
          chunks.push({ index: index++, text: sentenceBuf.join(" ") });
        }
      } else {
        flush();
        buffer.push(paragraph);
        size = paragraph.length;
      }
    } else {
      buffer.push(paragraph);
      size = nextSize;
    }
  }
  flush();
  return chunks;
}
