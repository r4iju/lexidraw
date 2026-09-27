/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const {
  chunkSections,
  htmlToSpeechText,
  normalizeForTts,
  sanitizeMarkdownForTts,
  speakingSeconds,
  splitMarkdownIntoSections,
  splitSentences,
} = await import("./markdown-for-tts");

const partsOf = (md: string) =>
  chunkSections(splitMarkdownIntoSections(sanitizeMarkdownForTts(md)));

const EN = "The quiet river ran past the old mill at the edge of town.";
const JA = "古い水車小屋のそばを、静かな川が町のはずれまで流れていた。";
/** A paragraph of `n` sentences, each numbered so no two paragraphs match. */
const paragraph = (sentence: string, n: number, tag = "") =>
  Array.from({ length: n }, (_, i) => `${tag}${i} ${sentence}`).join(" ");

describe("sentences", () => {
  test("split at .!? before a space and at 。！？ without one", () => {
    expect(splitSentences("One. Two? Three! 四。五！「六？」七")).toEqual([
      "One.",
      "Two?",
      "Three!",
      "四。",
      "五！",
      "「六？」",
      "七",
    ]);
  });

  test("keep a decimal whole", () => {
    expect(splitSentences("Pi is 3.14 or so. Yes.")).toEqual([
      "Pi is 3.14 or so.",
      "Yes.",
    ]);
  });

  test("are timed by script: CJK reads at a third of Latin's characters", () => {
    expect(speakingSeconds("a".repeat(150))).toBeCloseTo(10);
    expect(speakingSeconds("あ".repeat(50))).toBeCloseTo(10);
  });
});

describe("markdown read aloud", () => {
  test("loses its emphasis, bullets and quote marks", () => {
    expect(
      sanitizeMarkdownForTts(
        "Some **bold**, *italic*, __strong__ and ~~gone~~ `code` in snake_case.\n\n- first item\n- second item\n1. numbered\n\n> quoted line",
      ),
    ).toBe(
      "Some bold, italic, strong and gone code in snake_case.\n\nfirst item.\nsecond item.\nnumbered.\n\nquoted line",
    );
  });

  test("reads a table as its header, then row by row", () => {
    expect(
      sanitizeMarkdownForTts(
        "| City | People | Country |\n| --- | ---: | --- |\n| **Tokyo** | 14 million | Japan |\n| 大阪 | 270万 | 日本 |",
      ),
    ).toBe(
      "City, People, Country.\nTokyo, 14 million, Japan.\n大阪, 270万, 日本。",
    );
    expect(
      sanitizeMarkdownForTts("| Before | After |\n|--|--|\n| flat | round |"),
    ).toBe("Before, After.\nflat, round.");
  });

  test("keeps code blocks, images and equations out", () => {
    expect(
      sanitizeMarkdownForTts(
        "Text ![alt](x.png) and $x^2$.\n\n```js\nlet a | b |\n```\n\n$$\ny\n$$",
      ),
    ).toBe("Text and .");
  });
});

describe("an article's HTML read aloud", () => {
  test("keeps its paragraphs apart and reads lists and tables as sentences", () => {
    expect(
      htmlToSpeechText(
        "<p>First &amp; <b>best</b>.</p><p>Second.</p><ul><li>one</li><li>two</li></ul><table><tr><th>Name</th><th>Age</th></tr><tr><td>Ann</td><td>30</td></tr></table>",
      ),
    ).toBe("First & best.\n\nSecond.\n\none.\ntwo.\n\nName, Age.\nAnn, 30.");
  });
});

describe("parts", () => {
  test("begin with one or two sentences", () => {
    const [first] = partsOf(`# Title\n\n${paragraph(EN, 30)}`);
    expect(first?.text).toBe(`# Title\n\n0 ${EN}`);

    const [short] = partsOf(`Hi. ${paragraph(EN, 30)}`);
    expect(short?.text).toBe(`Hi. 0 ${EN}`);
  });

  test("of a long Japanese paragraph split at 。 under the cap", () => {
    const parts = partsOf(`${JA}\n\n${paragraph(JA, 60)}`);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      expect(speakingSeconds(part.text)).toBeLessThanOrEqual(60);
      expect(part.text.endsWith("。")).toBe(true);
    }
  });

  test("of English and Japanese run to similar spoken lengths", () => {
    const seconds = (sentence: string) =>
      partsOf(`${sentence}\n\n${paragraph(sentence, 80)}`)
        .slice(1, -1)
        .map((part) => speakingSeconds(part.text));
    const en = seconds(EN);
    const ja = seconds(JA);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(en)).toBeGreaterThan(45);
    expect(mean(ja)).toBeGreaterThan(45);
    expect(Math.abs(mean(en) - mean(ja))).toBeLessThan(10);
  });

  test("never hold a heading alone when text follows it", () => {
    const parts = partsOf(
      `Intro.\n\n# Book\n\n## Chapter\n\n${paragraph(EN, 3)}\n\n### Empty\n\n#### Next\n\nText.\n\n## Last`,
    );
    expect(parts.map((part) => part.text)).toEqual([
      "Intro.",
      `# Book\n\n## Chapter\n\n${paragraph(EN, 3)}`,
      "### Empty\n\n#### Next\n\nText.",
      "## Last",
    ]);
  });

  test("an edit remakes only the part holding it", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) =>
      paragraph(EN, 4, `p${i}-`),
    );
    const hashes = (md: string) =>
      partsOf(md).map((part) => normalizeForTts(part.text));
    const before = hashes(`Opening.\n\n${paragraphs.join("\n\n")}`);
    const edited = [...paragraphs];
    edited[2] = `${edited[2]} An added sentence, and another one after it.`;
    const after = hashes(`Opening.\n\n${edited.join("\n\n")}`);

    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((text, i) => (text === before[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
  });

  test("join short paragraphs to the one before", () => {
    const parts = partsOf(
      `Opening.\n\n${paragraph(EN, 4)}\n\nShort one.\n\nShort two.\n\n${paragraph(EN, 4, "b")}`,
    );
    expect(parts.map((part) => part.text)).toEqual([
      "Opening.",
      `${paragraph(EN, 4)}\n\nShort one.\n\nShort two.`,
      paragraph(EN, 4, "b"),
    ]);
  });
});
