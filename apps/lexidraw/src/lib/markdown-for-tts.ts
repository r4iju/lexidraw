import "server-only";

export type DocChunk = {
  index: number;
  sectionTitle?: string;
  sectionIndex?: number;
  headingDepth?: number;
  text: string;
};

export type Section = {
  title?: string;
  depth: number;
  body: string;
  index: number;
};

/**
 * Removes code blocks, inline code, equations, images, and other non-textual
 * markdown elements that shouldn't be read aloud.
 */
export function sanitizeMarkdownForTts(md: string): string {
  let result = md;

  // Remove code fences (``` or ~~~ blocks)
  result = result.replace(/```[\s\S]*?```/g, "");
  result = result.replace(/~~~[\s\S]*?~~~/g, "");

  // Remove inline code
  result = result.replace(/`[^`]+`/g, "");

  // Remove equations ($...$ and $$...$$)
  result = result.replace(/\$\$[\s\S]*?\$\$/g, "");
  result = result.replace(/\$[^$\n]+\$/g, "");

  // Remove images ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

  // Remove links but keep the text content: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove horizontal rules
  result = result.replace(/^[-*]{3,}$/gm, "");

  // Remove tables (simple markdown table syntax)
  result = result.replace(/^\|.*\|$/gm, "");
  result = result.replace(/^\|[\s\-:|]+\|$/gm, "");

  // Remove tweet embeds
  result = result.replace(/<tweet[^>]*\/>/g, "");

  // Remove article embeds (they're already expanded in markdown)
  // Keep the content but remove the article wrapper

  // Remove any remaining HTML-like tags
  result = result.replace(/<[^>]+>/g, "");

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Splits markdown into sections based on heading levels (H1-H6).
 * Returns an array of sections with title, depth, and body content.
 */
export function splitMarkdownIntoSections(md: string): Section[] {
  const sections: Section[] = [];
  const lines = md.split("\n");
  let currentSection: Section | null = null;
  let currentBody: string[] = [];
  let sectionCounter = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if exists
      if (currentSection !== null) {
        currentSection.body = currentBody.join("\n").trim();
        sections.push(currentSection);
      }

      // Start new section
      const depth = headingMatch[1]?.length;
      const title = headingMatch[2]?.trim();
      if (!depth || !title) continue;
      currentSection = { title, depth, body: "", index: sectionCounter++ };
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Save last section
  if (currentSection !== null) {
    currentSection.body = currentBody.join("\n").trim();
    sections.push(currentSection);
  } else if (md.trim()) {
    // No headings found, create a single section with all content
    sections.push({ title: undefined, depth: 0, body: md.trim(), index: 0 });
  }

  return sections;
}

/**
 * Chunks sections into smaller pieces for TTS synthesis.
 * Within each section, batches adjacent paragraphs to target size.
 */
export function chunkSections(
  sections: Section[],
  opts?: { targetSize?: number; hardCap?: number },
): DocChunk[] {
  const targetSize = Math.max(200, Math.min(2000, opts?.targetSize ?? 1400));
  const hardCap = Math.max(targetSize, opts?.hardCap ?? 4000);
  const chunks: DocChunk[] = [];
  let globalIndex = 0;

  for (const section of sections) {
    // If section has no body but has a title, create a chunk with just the heading
    if (!section.body.trim()) {
      if (section.title) {
        const headingText = `${"#".repeat(section.depth)} ${section.title}`;
        chunks.push({
          index: globalIndex++,
          sectionTitle: section.title,
          sectionIndex: section.index,
          headingDepth: section.depth,
          text: headingText,
        });
      }
      continue;
    }

    // Split section body into paragraphs
    const paragraphs = section.body
      .split(/\n{2,}/g)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) continue;

    let buffer: string[] = [];
    let size = 0;
    let isFirstChunk = true;

    const flush = () => {
      if (buffer.length === 0) return;
      let chunkText = buffer.join("\n\n");

      // Prepend heading to first chunk of section if section has a title
      if (isFirstChunk && section.title) {
        const headingPrefix =
          "#".repeat(section.depth) + " " + section.title + "\n\n";
        chunkText = headingPrefix + chunkText;
        isFirstChunk = false;
      }

      chunks.push({
        index: globalIndex++,
        sectionTitle: section.title,
        sectionIndex: section.index,
        headingDepth: section.depth,
        text: chunkText,
      });
      buffer = [];
      size = 0;
    };

    for (const paragraph of paragraphs) {
      const nextSize = size + (size > 0 ? 2 : 0) + paragraph.length;

      if (nextSize > targetSize) {
        if (size === 0 && paragraph.length > hardCap) {
          // Break huge paragraph at sentence boundaries
          const sentences = paragraph.split(/(?<=[.!?])\s+/);
          let sentenceBuf: string[] = [];
          let sentenceSize = 0;
          let isFirstSentenceChunk = isFirstChunk;

          for (const sentence of sentences) {
            const nextSentenceSize =
              sentenceSize + (sentenceSize > 0 ? 1 : 0) + sentence.length;
            if (nextSentenceSize > hardCap) {
              if (sentenceBuf.length) {
                let chunkText = sentenceBuf.join(" ");
                if (isFirstSentenceChunk && section.title) {
                  const headingPrefix =
                    "#".repeat(section.depth) + " " + section.title + "\n\n";
                  chunkText = headingPrefix + chunkText;
                  isFirstSentenceChunk = false;
                }
                chunks.push({
                  index: globalIndex++,
                  sectionTitle: section.title,
                  sectionIndex: section.index,
                  headingDepth: section.depth,
                  text: chunkText,
                });
                sentenceBuf = [];
                sentenceSize = 0;
              }
              let chunkText = sentence;
              if (isFirstSentenceChunk && section.title) {
                const headingPrefix =
                  "#".repeat(section.depth) + " " + section.title + "\n\n";
                chunkText = headingPrefix + chunkText;
                isFirstSentenceChunk = false;
              }
              chunks.push({
                index: globalIndex++,
                sectionTitle: section.title,
                sectionIndex: section.index,
                headingDepth: section.depth,
                text: chunkText,
              });
            } else {
              sentenceBuf.push(sentence);
              sentenceSize = nextSentenceSize;
            }
          }

          if (sentenceBuf.length) {
            let chunkText = sentenceBuf.join(" ");
            if (isFirstSentenceChunk && section.title) {
              const headingPrefix =
                "#".repeat(section.depth) + " " + section.title + "\n\n";
              chunkText = headingPrefix + chunkText;
              isFirstSentenceChunk = false;
            }
            chunks.push({
              index: globalIndex++,
              sectionTitle: section.title,
              sectionIndex: section.index,
              headingDepth: section.depth,
              text: chunkText,
            });
          }
          isFirstChunk = false;
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
  }

  return chunks;
}

/**
 * Normalizes text for consistent hashing and TTS synthesis.
 * Applies Unicode normalization and collapses whitespace.
 */
export function normalizeForTts(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}
