/// <reference types="bun" />
import { installDom } from "~/test/dom";

installDom("https://app.test/documents/1");

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { act } from "react";
import { createRoot } from "react-dom/client";

const markdown = await import("@lexical/markdown");
const nodes = await import("@packages/lexical-nodes");
const { LexicalComposer } = await import("@lexical/react/LexicalComposer");
const { RichTextPlugin } = await import("@lexical/react/LexicalRichTextPlugin");
const { ContentEditable } = await import(
  "@lexical/react/LexicalContentEditable"
);
const { LexicalErrorBoundary } = await import(
  "@lexical/react/LexicalErrorBoundary"
);
const { default: CodeHighlightPlugin } = await import(
  "./code-highlight-plugin"
);

/** One sample per language a document is likely to hold. */
const samples: Record<string, string> = {
  typescript:
    "type User = { id: string; name?: string };\n// load one\nexport async function load(id: string): Promise<User> {\n  return (await fetch(`/u/${id}`)).json();\n}",
  python:
    'def fib(n: int) -> int:\n    """Fibonacci"""\n    # small\n    return n if n < 2 else fib(n - 1) + fib(n - 2)',
  rust: 'fn main() {\n    let v: Vec<i32> = (1..=3).collect();\n    println!("{:?}", v);\n}',
  sql: "SELECT id, title FROM entities\nWHERE owner_id = $1 AND deleted_at IS NULL -- live\nORDER BY updated_at DESC LIMIT 20;",
  json: '{\n  "name": "lexidraw",\n  "private": true,\n  "workspaces": ["apps/*"]\n}',
  bash: "#!/usr/bin/env bash\nset -euo pipefail\nbun run build:packages && echo done",
  css: ".toggle > summary { display: grid; gap: 0.25rem; }\n@media (max-width: 600px) { .toggle { padding: 0; } }",
  html: '<section class="hero">\n  <!-- hero -->\n  <h1>Hello</h1>\n</section>',
  diff: "@@ -1 +1 @@\n- const old = 1;\n+ const next = 2;\n  unchanged",
  markdown:
    "# Title\n\n- item\n- **bold** item\n1. [link](https://example.com)",
  go: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }',
  swift:
    'struct Toggle: View {\n  @State var open = false\n  var body: some View { Text("Hi") }\n}',
};

/** The light page's code background, as the stylesheet sets it. */
async function codeBackground() {
  const css = await readFile(
    new URL("../../../../styles/globals.css", import.meta.url),
    "utf8",
  );
  const match = css.match(
    /--code-background:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/,
  );
  if (!match) throw new Error("No light --code-background in globals.css");
  const [l, c, h] = match.slice(1).map(Number) as [number, number, number];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const [r, g, bl] = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("every light syntax colour reads at 4.5:1 on the code background", async () => {
  const source = Object.entries(samples)
    .map(([language, code]) => `\`\`\`${language}\n${code}\n\`\`\``)
    .join("\n\n");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <LexicalComposer
        initialConfig={{
          namespace: "code-colours-test",
          nodes: nodes.CORE_NODES,
          editorState: () =>
            markdown.$convertFromMarkdownString(
              source,
              nodes.CORE_TRANSFORMERS,
            ),
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <CodeHighlightPlugin />
      </LexicalComposer>,
    );
  });
  const blocks = () => [
    ...container.querySelectorAll<HTMLElement>(".document-code-body"),
  ];
  const coloured = () =>
    blocks().every((block) => block.querySelector('[style*="--shiki-light"]'));
  for (let waited = 0; !coloured() && waited < 20_000; waited += 50)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(coloured()).toBe(true);

  const background = await codeBackground();
  const languages = Object.keys(samples);
  const failing = blocks().flatMap((block, index) => {
    const colours = new Set(
      [...block.querySelectorAll<HTMLElement>("[style]")].flatMap(
        (token) =>
          token
            .getAttribute("style")
            ?.match(/--shiki-light:\s*(#[0-9a-f]{6})/i)
            ?.slice(1) ?? [],
      ),
    );
    return [...colours].flatMap((colour) => {
      const ratio = (background + 0.05) / (luminance(colour) + 0.05);
      return ratio < 4.5
        ? [`${languages[index]} ${colour} ${ratio.toFixed(2)}`]
        : [];
    });
  });
  expect(failing).toEqual([]);
  await act(async () => root.unmount());
  container.remove();
}, 30_000);
