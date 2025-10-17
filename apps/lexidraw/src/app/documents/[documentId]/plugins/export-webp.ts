"use client";

import html2canvas from "html2canvas-pro";

type Props = {
  setTheme: () => void;
  restoreTheme: () => void;
};

export function useExportWebp() {
  type ThumbnailExportFlags = {
    skipHeavyEmbeds: boolean;
    replaceImages: "none" | "dominantColor" | "downscale";
    stripComplexStyles: boolean;
    foreignObjectRendering: boolean;
    maxTraverseNodes: number | null;
    reduceFonts: boolean;
    scale: number; // default 1
    // Additional aggressive optimizations
    isolateCloneDocument: boolean; // keep only the target in cloned document body
    pruneDepth: number | null; // keep only first N levels of DOM under target
    keepFirstChildren: number | null; // for each element, keep first N element-children
    charLimitPerTextNode: number | null; // truncate individual text nodes
  };

  function resolveFlags(
    overrides?: Partial<ThumbnailExportFlags>,
  ): ThumbnailExportFlags {
    const defaults: ThumbnailExportFlags = {
      skipHeavyEmbeds: false,
      replaceImages: "none",
      stripComplexStyles: false,
      foreignObjectRendering: false,
      maxTraverseNodes: null,
      reduceFonts: false,
      scale: 1,
      isolateCloneDocument: false,
      pruneDepth: null,
      keepFirstChildren: null,
      charLimitPerTextNode: null,
    };
    try {
      const ls =
        typeof window !== "undefined"
          ? localStorage.getItem("thumbnailFlags")
          : null;
      const fromLS = ls
        ? (JSON.parse(ls) as Partial<ThumbnailExportFlags>)
        : {};
      return { ...defaults, ...fromLS, ...overrides } as ThumbnailExportFlags;
    } catch {
      return { ...defaults, ...(overrides || {}) } as ThumbnailExportFlags;
    }
  }

  function pruneByDepth(root: Element, maxDepth: number): void {
    function walk(node: Element, depth: number): void {
      if (depth >= maxDepth) {
        // Remove all descendants beyond this level
        while (node.firstChild) node.removeChild(node.firstChild);
        return;
      }
      const children = Array.from(node.children);
      for (const child of children) {
        walk(child as Element, depth + 1);
      }
    }
    walk(root, 0);
  }

  function keepOnlyFirstChildren(root: Element, keep: number): void {
    const stack: Element[] = [root];
    while (stack.length) {
      const el = stack.pop() as Element;
      const children = Array.from(el.children);
      const toKeep = children.slice(0, Math.max(keep, 0));
      const toRemove = children.slice(Math.max(keep, 0));
      for (const r of toRemove) r.remove();
      for (const k of toKeep) stack.push(k as Element);
    }
  }

  function limitTextNodes(root: Element, limit: number): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      texts.push(n);
    }
    for (const t of texts) {
      const value = t.nodeValue || "";
      if (value.length > limit) t.nodeValue = `${value.slice(0, limit)}…`;
    }
  }
  function dataURItoBlob(dataURI: string) {
    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
    const byteString = atob(dataURI.split(",")[1] as string);

    // separate out the mime component
    const mimeString = (
      (dataURI.split(",")[0] as string).split(":")[1] as string
    ).split(";")[0];

    // write the bytes of the string to an ArrayBuffer
    const ab = new ArrayBuffer(byteString.length);

    // create a view into the buffer
    const ia = new Uint8Array(ab);

    // set the bytes of the buffer to the correct values
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    // write the ArrayBuffer to a blob, and you're done
    const blob = new Blob([ab], { type: mimeString });
    return blob;
  }

  /**
   * Export WEBP thumbnail with optional performance flags.
   *
   * You can override defaults at callsite or via localStorage key `thumbnailFlags`.
   * Example:
   * localStorage.setItem('thumbnailFlags', JSON.stringify({ skipHeavyEmbeds: true, replaceImages: 'dominantColor' }))
   */
  async function exportWebp(
    { setTheme, restoreTheme }: Props,
    opts?: Partial<ThumbnailExportFlags>,
  ): Promise<Blob> {
    const flags = resolveFlags(opts);
    const element = (document.querySelector('[id^="lexical-content-"]') ||
      document.querySelector("#lexical-content")) as HTMLElement;
    if (!element) {
      throw new Error("Lexical content element not found");
    }

    setTheme();

    // Capture element as WEBP using html2canvas; tweak internal clone only
    const canvas = await html2canvas(element, {
      scale: flags.scale,
      width: 500,
      height: 400,
      windowWidth: 500,
      windowHeight: 400,
      useCORS: true,
      backgroundColor: null, // optional, depends on if you want transparency
      foreignObjectRendering: flags.foreignObjectRendering,
      ignoreElements: flags.skipHeavyEmbeds
        ? (node: Element) => {
            const el = node as HTMLElement;
            if (!el || el.nodeType !== 1) return false;
            const tag = el.tagName.toLowerCase();
            if (tag === "iframe" || tag === "video" || tag === "canvas")
              return true;
            // Common embed wrappers (opt-in skip): handle SVG/HTML className differences
            // className can be SVGAnimatedString in SVG; narrow types safely
            const classNameValue = (
              el as unknown as { className?: string | { baseVal?: string } }
            ).className;
            const clsStr =
              typeof classNameValue === "string"
                ? classNameValue
                : typeof classNameValue === "object" &&
                    classNameValue &&
                    "baseVal" in classNameValue
                  ? ((classNameValue as { baseVal?: string }).baseVal ?? "")
                  : "";
            const tokens: string[] = el.classList
              ? Array.from(el.classList)
              : clsStr.split(/\s+/);
            const contains = (needle: string) =>
              tokens.some((t) => t.includes(needle)) || clsStr.includes(needle);
            if (
              contains("tweet") ||
              contains("youtube") ||
              contains("excalidraw") ||
              contains("mermaid") ||
              contains("chart") ||
              contains("figma")
            ) {
              return true;
            }
            return false;
          }
        : undefined,
      onclone: (clonedDocument) => {
        const clonedTarget = (
          element.id
            ? clonedDocument.getElementById(element.id)
            : clonedDocument.querySelector('[id^="lexical-content-"]')
        ) as HTMLElement | null;
        if (clonedTarget) {
          if (flags.isolateCloneDocument) {
            const body = clonedDocument.body;
            while (body.firstChild) body.removeChild(body.firstChild);
            body.appendChild(clonedTarget);
          }
          clonedTarget.style.width = "500px";
          clonedTarget.style.height = "400px";
          clonedTarget.style.overflow = "hidden";
          clonedTarget.classList.remove("pt-20", "px-6", "border-x");
          clonedTarget.classList.add("p-2");
          if (flags.reduceFonts) {
            clonedTarget.style.fontFamily =
              "system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif";
          }

          if (flags.stripComplexStyles) {
            const style = clonedDocument.createElement("style");
            style.textContent = `
              * { text-shadow: none !important; box-shadow: none !important; filter: none !important; }
              *, *::before, *::after { animation: none !important; transition: none !important; }
            `;
            clonedDocument.head.appendChild(style);
          }

          if (flags.replaceImages !== "none") {
            const imgs = clonedTarget.querySelectorAll("img");
            imgs.forEach((img) => {
              const el = img as HTMLImageElement;
              if (flags.replaceImages === "dominantColor") {
                const ph = clonedDocument.createElement("div");
                ph.style.width = `${el.width || el.naturalWidth || 100}px`;
                ph.style.height = `${el.height || el.naturalHeight || 80}px`;
                ph.style.background = el.style.background || "#e5e7eb"; // neutral placeholder
                el.replaceWith(ph);
              } else if (flags.replaceImages === "downscale") {
                // Hint downscale via CSS to reduce decode/paint cost inside the clone
                el.loading = "eager";
                el.decoding = "sync" as unknown as HTMLImageElement["decoding"];
                el.style.imageRendering = "-webkit-optimize-contrast";
                el.style.maxWidth = "100%";
              }
            });
          }

          if (flags.pruneDepth != null) {
            pruneByDepth(clonedTarget, flags.pruneDepth);
          }

          if (flags.keepFirstChildren != null) {
            keepOnlyFirstChildren(clonedTarget, flags.keepFirstChildren);
          }

          if (flags.charLimitPerTextNode != null) {
            limitTextNodes(clonedTarget, flags.charLimitPerTextNode);
          }

          if (flags.maxTraverseNodes != null) {
            let count = 0;
            const walker = clonedDocument.createTreeWalker(
              clonedTarget,
              NodeFilter.SHOW_ELEMENT,
            );
            const toRemove: Element[] = [];
            while (walker.nextNode()) {
              count += 1;
              if (count > flags.maxTraverseNodes) {
                const node = walker.currentNode as Element;
                toRemove.push(node);
              }
            }
            toRemove.forEach((n) => {
              n.remove();
            });
          }
        }
      },
    });

    // restore theme
    restoreTheme();

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to get canvas 2D context");
    }

    // image data to blob
    const url = canvas.toDataURL("image/webp");
    const blob = dataURItoBlob(url);
    if (!blob) {
      throw new Error("Failed to create blob");
    }

    return blob;
  }

  return { exportWebp };
}
