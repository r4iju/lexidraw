import type { TableOfContentsEntry } from "@lexical/react/LexicalTableOfContentsPlugin";
import type { HeadingTagType } from "@lexical/rich-text";
import type { NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TableOfContentsPlugin as LexicalTableOfContentsPlugin } from "@lexical/react/LexicalTableOfContentsPlugin";
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import { Button } from "~/components/ui/button";

const FIXED_HEADER_HEIGHT = 70;
const SCROLL_TOP_PADDING = 20;
const ACTIVE_HEADING_ZONE_HEIGHT = 10;

const SCROLL_TARGET_ZONE_TOP = FIXED_HEADER_HEIGHT + SCROLL_TOP_PADDING;

function TableOfContentsList({
  tableOfContents,
}: {
  tableOfContents: TableOfContentsEntry[];
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState("");
  const selectedIndex = useRef(0);
  const [editor] = useLexicalComposerContext();

  const scrollToNodeWithPadding = useCallback(
    (key: NodeKey, currIndex: number) => {
      editor.getEditorState().read(() => {
        const domElement = editor.getElementByKey(key);
        if (domElement !== null) {
          const elementRect = domElement.getBoundingClientRect();
          const absoluteElementTop = elementRect.top + window.scrollY;
          const targetScrollPosition =
            absoluteElementTop - FIXED_HEADER_HEIGHT - SCROLL_TOP_PADDING;

          window.scrollTo({
            top: Math.max(0, targetScrollPosition),
            behavior: "smooth",
          });

          setSelectedKey(key);
          selectedIndex.current = currIndex;
        }
      });
    },
    [editor],
  );

  const headingToPadding = useCallback((tag: HeadingTagType): number => {
    switch (tag) {
      case "h1":
        return 0;
      case "h2":
        return 2; // Assuming Tailwind pl-2 = 0.5rem
      case "h3":
        return 4; // pl-4 = 1rem
      case "h4":
        return 6; // pl-6 = 1.5rem
      case "h5":
        return 8; // pl-8 = 2rem
      case "h6":
        return 10; // pl-10 = 2.5rem
      default:
        return 0;
    }
  }, []);

  useEffect(() => {
    function scrollCallback() {
      if (tableOfContents.length === 0) {
        if (selectedKey !== "") {
          setSelectedKey("");
          selectedIndex.current = 0;
        }
        return;
      }

      let currentActiveIndex = -1;
      const targetBottomLine =
        SCROLL_TARGET_ZONE_TOP + ACTIVE_HEADING_ZONE_HEIGHT;

      for (let i = 0; i < tableOfContents.length; i++) {
        const entry = tableOfContents[i];
        if (!entry) continue;
        const [key] = entry;
        const headingElement = editor.getElementByKey(key ?? "");
        if (headingElement) {
          const elementRect = headingElement.getBoundingClientRect();
          if (elementRect && elementRect.top < targetBottomLine) {
            currentActiveIndex = i;
          } else {
            break;
          }
        }
      }

      if (currentActiveIndex === -1 && tableOfContents.length > 0) {
        currentActiveIndex = 0;
      }

      if (currentActiveIndex !== -1) {
        const entry = tableOfContents[currentActiveIndex];
        if (entry) {
          const newKey = entry[0];
          if (newKey !== selectedKey) {
            setSelectedKey(newKey ?? "");
            selectedIndex.current = currentActiveIndex;
          }
        } else {
          console.error(
            "TOC scroll logic error: Invalid index",
            currentActiveIndex,
            tableOfContents,
          );
          if (selectedKey !== "") {
            setSelectedKey("");
            selectedIndex.current = 0;
          }
        }
      } else if (selectedKey !== "") {
        setSelectedKey("");
        selectedIndex.current = 0;
      }
    }

    let timerId: ReturnType<typeof setTimeout>;

    function debounceFunction(func: () => void, delay: number) {
      clearTimeout(timerId);
      timerId = setTimeout(func, delay);
    }

    function onScroll(): void {
      debounceFunction(scrollCallback, 50); // 50ms debounce interval
    }

    document.addEventListener("scroll", onScroll, { passive: true });

    scrollCallback();

    return () => {
      document.removeEventListener("scroll", onScroll);
      clearTimeout(timerId);
    };
  }, [tableOfContents, editor, selectedKey]);

  return (
    <div className="p-4">
      {tableOfContents.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-4 py-2">
          No headings found.
        </p>
      ) : (
        <ul className="space-y-1">
          {tableOfContents.map(([key, text, tag], index) => (
            <li
              key={key}
              className={`relative pl-${headingToPadding(tag)} pr-4`}
            >
              <Button
                variant="link"
                onClick={() => scrollToNodeWithPadding(key, index)}
                className="p-0 text-foreground h-auto whitespace-normal text-left text-sm leading-snug hover:underline focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                title={text}
              >
                <span
                  className={`${selectedKey === key ? "font-bold text-primary" : ""}`}
                >
                  {text.length > 35 ? `${text.substring(0, 35)}...` : text}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
