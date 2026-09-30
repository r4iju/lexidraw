import { htmlOracle, htmlForDocument } from "./html-oracle.js";

// Clipboard-shaped examples contain no private document contents.
const samples = [
  [
    "Stylesheets",
    "<html><head><style>.emphasis { font-weight: bold; font-style: italic }</style></head><body><p class='emphasis'>Styled</p><p><span class='emphasis' style='font-weight:normal'>Inline wins</span></p></body></html>",
  ],
  [
    "Recovered headings",
    "<h2><sup><span>alpha</span><br></sup></h6><h2><sub><mark>日本語</mark></sub></h3>",
  ],
  [
    "Safari",
    "<meta charset='utf-8'><h2>Heading</h2><p><b>bold</b> <i>italic</i> <u>underlined</u> <s>deleted</s> <code>code</code> <sub>sub</sub><sup>sup</sup><mark>highlight</mark></p><blockquote>quote<br>next</blockquote><hr>",
  ],
  [
    "Notes",
    "<div><div>First</div><div>Second</div></div><ul><li>one</li><li>two</li></ul>",
  ],
  [
    "Pages",
    "<p style='text-align:center;padding-inline-start:80px'><span style='font-weight:700;font-style:italic;text-decoration:underline'>Styled</span><a href='https://example.com' title='title' rel='noopener' target='_blank'>link</a></p>",
  ],
  [
    "Google Docs",
    "<b style='font-weight:normal'><p><span style='font-weight:700'>Bold</span><span style='vertical-align:super'>sup</span></p><ul><li aria-checked='true'>checked</li><li aria-checked='false'>unchecked</li></ul></b>",
  ],
  [
    "Word",
    "<div><p class='MsoNormal'><span style='font-family:Calibri;font-weight:bold'>Text &amp; entities &#169;</span></p><ol start='3'><li>three</li><li>four</li></ol></div>",
  ],
  [
    "Table",
    "<table><colgroup><col width='100'><col style='width:120px'></colgroup><tr><th>A</th><th>B</th></tr><tr><td><b>one</b></td><td>two</td></tr></table>",
  ],
];
samples.push([
  "Lexical Word",
  await Bun.file(
    new URL(
      "../Tests/LexicalSwiftTests/Fixtures/HTML/upstream/word.html",
      import.meta.url,
    ),
  ).text(),
]);
// Keep captured Word's expected conversion tied to a real browser DOMParser.
const wordOracle = await Bun.file(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/upstream/word.chromium.json",
    import.meta.url,
  ),
).json();
const fixtures = samples.map(([name, html]) => {
  if (!name || !html) throw new Error("Missing sample");
  return {
    name,
    html,
    nodes: name === "Lexical Word" ? wordOracle.nodes : htmlOracle(html),
  };
});
// Actual Safari clipboard HTML uses frozen real-browser converter output.
const safariOracle = await Bun.file(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/upstream/safari-local.chromium.json",
    import.meta.url,
  ),
).json();
fixtures.push({
  name: safariOracle.name,
  html: safariOracle.html,
  nodes: safariOracle.nodes,
});
await Bun.write(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/paste.json",
    import.meta.url,
  ),
  `${JSON.stringify(fixtures, null, 2)}\n`,
);

let seed = Number(process.env.HTML_FUZZ_SEED ?? 168);
function random(upper: number) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % upper;
}
const tags = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "code",
  "sub",
  "sup",
  "mark",
  "span",
];
function inline(depth = 0): string {
  const words = [
    "alpha",
    "βeta",
    "日本語",
    "&amp;",
    "&#169;",
    "x y",
    " x ",
    "a\tb",
    "a\nb",
  ];
  const word = words[random(words.length)];
  if (depth > 2 || random(3) === 0) return word ?? "";
  const tag = tags[random(tags.length)] ?? "span";
  return `<${tag}>${inline(depth + 1)}${random(3) === 0 ? "<br>" : ""}</${tag}>`;
}
function block(): string {
  switch (random(5)) {
    case 0:
      return `<p>${inline()} ${inline()}</p>`;
    case 1: {
      const level = random(6) + 1;
      return `<h${level}>${inline()}</h${level}>`;
    }
    case 2:
      return `<blockquote><div>${inline()}</div><div>${inline()}</div></blockquote>`;
    case 3:
      return `<ul><li>${inline()}</li><li>${inline()}</li></ul>`;
    default:
      return `<p>${inline()}<a href="https://example.com">${inline()}</a></p>`;
  }
}
const fuzz = Array.from(
  { length: Number(process.env.HTML_FUZZ_CASES ?? 500) },
  (_, index) => {
    const html = block() + block();
    return {
      name: `seed ${process.env.HTML_FUZZ_SEED ?? 168} case ${index}`,
      html,
      nodes: htmlOracle(html),
    };
  },
);
await Bun.write(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/fuzz.json",
    import.meta.url,
  ),
  `${JSON.stringify(fuzz)}\n`,
);

const documents: unknown[] = await Bun.file(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/documents.json",
    import.meta.url,
  ),
).json();
const generated = documents.map((document, index) => {
  const html = htmlForDocument(document);
  return {
    name: `LexicalFuzz seed 168 document ${index}`,
    html,
    nodes: htmlOracle(html),
  };
});
await Bun.write(
  new URL(
    "../Tests/LexicalSwiftTests/Fixtures/HTML/node-fuzz.json",
    import.meta.url,
  ),
  `${JSON.stringify(generated)}\n`,
);
