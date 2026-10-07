/** Serializable browser callback: each visible text node belongs to one reading segment. */
type ArticleImage = {
  url?: string;
  heading?: boolean;
  source: string;
  alt: string;
  textIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  objectFit: string;
  overlay: boolean;
  refusal?: string;
};
type ArticleInteractions = {
  accessibleText?: string;
  links?: {
    url: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  accessibility?: {
    role: "heading" | "text" | "link";
    heading?: boolean;
    text: string;
    url?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  articleImages?: ArticleImage[];
};
export function extractArticleInteractions(
  includeAccessibility = false,
  includeImages = false,
): ArticleInteractions {
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
  if (!includeAccessibility && !includeImages)
    return { accessibleText: article.innerText, links };
  const accessibility: {
    role: "heading" | "text" | "link";
    text: string;
    heading?: boolean;
    url?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  const articleImages: {
    source: string;
    alt: string;
    textIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    objectFit: string;
    overlay: boolean;
    refusal?: string;
    url?: string;
    heading?: boolean;
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
        ...(group.heading ? { heading: true } : {}),
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
    if (element instanceof HTMLImageElement && includeImages) {
      flush();
      const rect = element.getBoundingClientRect();
      if (style.visibility === "visible" && rect.width > 0 && rect.height > 0) {
        if (articleImages.length >= 64)
          throw new Error("Article exceeds image element limit");
        let supported =
          element.naturalWidth > 0 &&
          element.naturalHeight > 0 &&
          ["fill", "contain", "cover"].includes(style.objectFit) &&
          style.objectPosition === "50% 50%";
        for (
          let parent: HTMLElement | null = element;
          parent && root.contains(parent);
          parent = parent.parentElement
        ) {
          const css = getComputedStyle(parent);
          supported &&=
            css.transform === "none" &&
            css.filter === "none" &&
            css.opacity === "1" &&
            css.mixBlendMode === "normal" &&
            css.clipPath === "none" &&
            css.maskImage === "none" &&
            css.backdropFilter === "none" &&
            (parent === element ||
              (css.overflowX === "visible" && css.overflowY === "visible"));
        }
        supported &&=
          style.position === "static" &&
          style.boxShadow === "none" &&
          style.outlineStyle === "none" &&
          style.backgroundImage === "none" &&
          style.backgroundColor === "rgba(0, 0, 0, 0)";
        supported &&= [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius,
        ].every((value) => value === "0px");
        // Native image views sit above the raster. Refuse intersecting content
        // rather than changing the browser's paint order.
        if (supported) {
          const overlaps = (other: DOMRect) =>
            other.width > 0 &&
            other.height > 0 &&
            other.left < rect.right &&
            other.right > rect.left &&
            other.top < rect.bottom &&
            other.bottom > rect.top;
          const walker = document.createTreeWalker(
            article,
            NodeFilter.SHOW_TEXT,
          );
          let inspected = 0;
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            if (++inspected > 4096) {
              supported = false;
              break;
            }
            if (!text.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            if (Array.from(range.getClientRects()).some(overlaps)) {
              supported = false;
              break;
            }
          }
          const others = article.querySelectorAll("*");
          if (others.length > 4096) supported = false;
          else
            for (const other of others) {
              if (
                other !== element &&
                !other.contains(element) &&
                overlaps(other.getBoundingClientRect())
              ) {
                supported = false;
                break;
              }
            }
        }
        articleImages.push({
          source: element.currentSrc || element.src,
          alt: ["none", "presentation"].includes(
            element.getAttribute("role") ?? "",
          )
            ? ""
            : (element.getAttribute("aria-label") ?? element.alt),
          ...(entry.url ? { url: entry.url } : {}),
          ...(entry.heading ? { heading: true } : {}),
          textIndex: accessibility.length,
          x: rect.x - origin.x,
          y: rect.y - origin.y,
          width: rect.width,
          height: rect.height,
          objectFit: style.objectFit,
          overlay: supported,
          ...(!supported
            ? {
                refusal:
                  "Article image style requires the raster preview (#134)",
              }
            : {}),
        });
      }
      continue;
    }
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
  return {
    accessibleText: article.innerText,
    links,
    ...(includeAccessibility ? { accessibility } : {}),
    ...(includeImages ? { articleImages } : {}),
  };
}
