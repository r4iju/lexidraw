/// <reference types="bun" />
import { expect, mock, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import type { ArticleNodeData } from "@packages/types";
import { installDom, render } from "~/test/dom";

installDom("https://app.test/documents/1");

mock.module("~/trpc/react", () => ({
  api: {
    entities: {
      load: { useQuery: () => ({ data: undefined, isError: false }) },
    },
    articles: {
      extractFromUrl: {
        useMutation: () => ({ mutateAsync: async () => ({}) }),
      },
    },
  },
}));
const { ArticleBlock } = await import("./ArticleBlock");

async function article(data: ArticleNodeData) {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: "article-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <ArticleBlock
        className={{ base: "", focus: "" }}
        nodeKey="article"
        data={data}
      />
    </LexicalComposer>,
  );
}

const ARTICLE = `<p>Readers of long pages want them short.</p><h2>Section</h2><p>More of the article.</p>`;

test("a saved page shows as a card with its title, description, site and picture, opening the page", async () => {
  const view = await article({
    mode: "url",
    url: "https://www.example.com/blog/a-post?ref=feed",
    distilled: {
      title: "A distilled article",
      excerpt: "What the page says it is about.",
      bestImageUrl: "https://www.example.com/cover.png",
      contentHtml: ARTICLE,
    },
  });
  const card = document.querySelector<HTMLAnchorElement>(
    'a[href="https://www.example.com/blog/a-post?ref=feed"]',
  );
  expect(card?.textContent).toContain("A distilled article");
  expect(card?.textContent).toContain("What the page says it is about.");
  expect(card?.textContent).toContain("example.com");
  expect(card?.querySelector("img")?.getAttribute("src")).toBe(
    "https://www.example.com/cover.png",
  );
  expect(document.body.textContent).not.toContain("More of the article.");
  await view.unmount();
});

test("a saved page without a description is described by the start of its text", async () => {
  const view = await article({
    mode: "url",
    url: "https://example.com/article",
    distilled: { title: "A distilled article", contentHtml: ARTICLE },
  });
  expect(document.querySelector("a")?.textContent).toContain(
    "Readers of long pages want them short.",
  );
  expect(document.querySelector("a img")).toBeNull();
  await view.unmount();
});
