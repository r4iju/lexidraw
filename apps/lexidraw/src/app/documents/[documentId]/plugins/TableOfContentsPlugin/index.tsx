import type { TableOfContentsEntry } from "@lexical/react/LexicalTableOfContentsPlugin";
import type { NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TableOfContentsPlugin as LexicalTableOfContentsPlugin } from "@lexical/react/LexicalTableOfContentsPlugin";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as React from "react";
import { cn } from "~/lib/utils";
import { outlineLevels } from "./outline";

/** Where reading happens: just under the page's sticky toolbar. */
function readingLine(): number {
  return (
    Number.parseFloat(
      getComputedStyle(document.documentElement).scrollPaddingTop,
    ) || 0
  );
}

function TableOfContentsList({
  tableOfContents,
}: {
  tableOfContents: TableOfContentsEntry[];
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [current, setCurrent] = useState<NodeKey | null>(null);
  // A heading jumped to stays current until the reader scrolls again, even
  // when the end of the document keeps it from reaching the top.
  const pinned = useRef<NodeKey | null>(null);
  const levels = useMemo(
    () => outlineLevels(tableOfContents.map(([, , tag]) => tag)),
    [tableOfContents],
  );

  const jump = (key: NodeKey) => {
    const heading = editor.getElementByKey(key);
    if (!heading) return;
    pinned.current = key;
    setCurrent(key);
    heading.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  // External system: the page's scroll position.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const line = readingLine() + 8;
      let found = tableOfContents[0]?.[0] ?? null;
      for (const [key] of tableOfContents) {
        const top = editor.getElementByKey(key)?.getBoundingClientRect().top;
        if (top === undefined) continue;
        if (top > line) break;
        found = key;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(measure);
    };
    const release = () => {
      pinned.current = null;
    };
    const readerMoves = ["wheel", "touchstart", "keydown"] as const;
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    for (const type of readerMoves)
      window.addEventListener(type, release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      for (const type of readerMoves) window.removeEventListener(type, release);
    };
  }, [editor, tableOfContents]);

  return (
    <nav aria-label="Table of contents" className="py-3 pr-3">
      {tableOfContents.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          Headings appear here as you add them.
        </p>
      ) : (
        <ol className="flex flex-col">
          {tableOfContents.map(([key, text], index) => {
            const level = levels[index] ?? 0;
            const isCurrent = key === current;
            return (
              <li key={key}>
                <button
                  type="button"
                  title={text}
                  aria-current={isCurrent ? "location" : undefined}
                  onClick={() => jump(key)}
                  style={{ "--level": level } as CSSProperties}
                  className={cn(
                    "block w-full truncate rounded-r-sm py-1 pr-2 pl-[calc(14px+var(--level)*14px)] text-left leading-5 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    level === 0
                      ? "text-sm font-semibold text-foreground"
                      : "text-[13px] text-muted-foreground",
                    isCurrent
                      ? "border-l-2 border-primary text-primary hover:text-primary"
                      : "border-l-2 border-transparent",
                  )}
                >
                  <span>{text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}

function TocPluginWrapper() {
  return (
    <LexicalTableOfContentsPlugin>
      {(tableOfContents) => {
        return <TableOfContentsList tableOfContents={tableOfContents} />;
      }}
    </LexicalTableOfContentsPlugin>
  );
}

export default TocPluginWrapper;
