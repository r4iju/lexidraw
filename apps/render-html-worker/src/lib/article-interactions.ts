/** Serializable browser callback: each visible text node belongs to one reading segment. */
export function extractArticleInteractions() {
  const article = document.querySelector<HTMLElement>("[data-native-article]");
  const root = document.getElementById("native-embed");
  if (!article || !root) return {};
  const origin = root.getBoundingClientRect();
  const links = Array.from(
    article.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).flatMap((anchor) =>
    Array.from(anchor.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        url: anchor.href,
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        width: rect.width,
        height: rect.height,
      })),
  );
  const accessibility: {
    role: "heading" | "text" | "link";
    text: string;
    url?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  let group:
    | { first: Text; last: Text; text: string; heading: boolean; url?: string }
    | undefined;
  function flush() {
    if (!group) return;
    const text = group.text.trim();
    const range = document.createRange();
    range.setStart(group.first, 0);
    range.setEnd(group.last, group.last.length);
    const rect = range.getBoundingClientRect();
    if (text && rect.width > 0 && rect.height > 0) {
      if (accessibility.length >= 4096)
        throw new Error("Article exceeds accessibility element limit");
      accessibility.push({
        role: group.url ? "link" : group.heading ? "heading" : "text",
        text,
        ...(group.url ? { url: group.url } : {}),
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        width: rect.width,
        height: rect.height,
      });
    }
    group = undefined;
  }
  // Block and anchor boundaries split runs; inline emphasis stays in its parent
  // run. Never read ancestor innerText as well as its descendant segments.
  const stack: {
    node: Node;
    heading: boolean;
    url?: string;
    exit?: boolean;
    boundary?: boolean;
  }[] = [{ node: article, heading: false }];
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (entry.exit) {
      if (entry.boundary) flush();
      continue;
    }
    if (entry.node instanceof Text) {
      const parent = entry.node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.visibility !== "visible") continue;
      const range = document.createRange();
      range.selectNodeContents(entry.node);
      if (
        !Array.from(range.getClientRects()).some(
          (rect) => rect.width > 0 && rect.height > 0,
        )
      )
        continue;
      const preservesSpace = ["pre", "pre-wrap", "break-spaces"].includes(
        style.whiteSpace,
      );
      let text = preservesSpace
        ? entry.node.data
        : style.whiteSpace === "pre-line"
          ? entry.node.data.replace(/[\t\r\f ]+/g, " ")
          : entry.node.data.replace(/[\t\n\r\f ]+/g, " ");
      if (!group)
        group = {
          first: entry.node,
          last: entry.node,
          text: "",
          heading: entry.heading,
          url: entry.url,
        };
      if (!preservesSpace && group.text.endsWith(" ") && text.startsWith(" "))
        text = text.slice(1);
      group.last = entry.node;
      group.text += text;
      continue;
    }
    if (!(entry.node instanceof HTMLElement)) continue;
    const element = entry.node;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      element.getAttribute("aria-hidden") === "true" ||
      element.matches("script,style,template")
    )
      continue;
    if (element.tagName === "BR") {
      if (group) group.text += "\n";
      continue;
    }
    const anchor =
      element instanceof HTMLAnchorElement && element.hasAttribute("href");
    const boundary = anchor || !["inline", "contents"].includes(style.display);
    if (boundary) flush();
    const heading = entry.heading || element.matches("h1,h2,h3,h4,h5,h6");
    const url = anchor ? element.href : entry.url;
    stack.push({ ...entry, exit: true, boundary });
    for (let index = element.childNodes.length - 1; index >= 0; index--) {
      const child = element.childNodes[index];
      if (child) stack.push({ node: child, heading, url });
    }
  }
  flush();
  return { accessibleText: article.innerText, links, accessibility };
}
