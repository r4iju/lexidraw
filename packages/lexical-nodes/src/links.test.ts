import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createAutoLinkNode,
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  AutoLinkNode,
  LinkNode,
  registerLink,
} from "@lexical/link";
import { namedSignals } from "@lexical/extension";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
} from "lexical";
import { saveLink, sanitizeUrl, validateUrl } from "./links.js";

/**
 * What the link editor saves for what's typed, under the browser's own
 * `URL`. The iOS app's `WebLinksTests` holds its copy of JavaScriptCore to
 * these.
 */
const SANITIZED_URLS: [string, string][] = [
  ["HTTPS://Example.COM", "https://example.com/"],
  ["https://example.com/a b?c=d e#f", "https://example.com/a%20b?c=d%20e#f"],
  ["https://münchen.de/straße", "https://xn--mnchen-3ya.de/stra%C3%9Fe"],
  ["http://a.io:80/./b/../c", "http://a.io/c"],
  ["mailto:Me@B.io", "mailto:Me@B.io"],
  ["tel:+1 555 0100", "tel:+1 555 0100"],
  ["ftp://x", "about:blank"],
  ["javascript:alert(1)", "about:blank"],
  ["https://", "https://"],
  ["www.a.io", "www.a.io"],
  ["", ""],
];

test.each(SANITIZED_URLS)("the link editor saves %p as %p", (typed, saved) => {
  expect(sanitizeUrl(typed)).toBe(saved);
});

function linkedEditor(link: () => ElementNode) {
  const editor = createHeadlessEditor({
    nodes: [LinkNode, AutoLinkNode],
    onError: (error) => {
      throw error;
    },
  });
  registerLink(editor, namedSignals({ attributes: undefined, validateUrl }));
  editor.update(
    () => {
      const text = $createTextNode("a.io");
      $getRoot().append($createParagraphNode().append(link().append(text)));
      text.select(1, 1);
    },
    { discrete: true },
  );
  return editor;
}

function savedLink(editor: ReturnType<typeof linkedEditor>) {
  return editor.read(() => {
    const link = $getRoot().getFirstDescendant()?.getParent();
    if (!$isLinkNode(link)) throw new Error("Expected a link");
    return { url: link.getURL(), isAutoLink: $isAutoLinkNode(link) };
  });
}

test("a saved link takes the URL as the link editor sanitizes it", () => {
  const editor = linkedEditor(() => $createLinkNode("https://a.io"));

  editor.update(() => saveLink(editor, "HTTPS://B.io"), { discrete: true });

  expect(savedLink(editor)).toEqual({
    url: "https://b.io/",
    isAutoLink: false,
  });
});

test("a saved autolink becomes a link, which typing no longer relinks", () => {
  const editor = linkedEditor(() => $createAutoLinkNode("https://a.io"));

  editor.update(() => saveLink(editor, "https://b.io"), { discrete: true });

  expect(savedLink(editor)).toEqual({
    url: "https://b.io/",
    isAutoLink: false,
  });
});

test("a link saved with no URL keeps the one it had", () => {
  const editor = linkedEditor(() => $createLinkNode("https://a.io"));

  editor.update(() => saveLink(editor, ""), { discrete: true });

  expect(savedLink(editor)).toEqual({
    url: "https://a.io",
    isAutoLink: false,
  });
});
