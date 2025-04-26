import type { TableOfContentsEntry } from "@lexical/react/LexicalTableOfContentsPlugin";
import type { HeadingTagType } from "@lexical/rich-text";
import type { NodeKey } from "lexical";
import { COMMAND_PRIORITY_LOW } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TableOfContentsPlugin as LexicalTableOfContentsPlugin } from "@lexical/react/LexicalTableOfContentsPlugin";
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import { Button } from "~/components/ui/button";
import { useTocContext, TOGGLE_TOC_COMMAND } from "../../context/toc-context";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";

const MARGIN_ABOVE_EDITOR = 624;
const HEADING_WIDTH = 9;

function TableOfContentsList({
  tableOfContents,
}: {
  tableOfContents: TableOfContentsEntry[];
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState("");
  const selectedIndex = useRef(0);
  const [editor] = useLexicalComposerContext();
  const { isTocOpen, toggleToc } = useTocContext();

  const isHeadingAtTheTopOfThePage = useCallback(
    (element: HTMLElement): boolean => {
      const elementYPosition = element?.getClientRects()[0]?.y;
      if (elementYPosition === undefined) {
        return false;
      }
      return (
        elementYPosition >= MARGIN_ABOVE_EDITOR &&
        elementYPosition <= MARGIN_ABOVE_EDITOR + HEADING_WIDTH
      );
    },
    [],
  );

  const isHeadingAboveViewport = useCallback(
    (element: HTMLElement): boolean => {
      const elementYPosition = element?.getClientRects()[0]?.y;
      if (elementYPosition === undefined) {
        return false;
      }
      return elementYPosition < MARGIN_ABOVE_EDITOR;
    },
    [],
  );

  const isHeadingBelowTheTopOfThePage = useCallback(
    (element: HTMLElement): boolean => {
      const elementYPosition = element?.getClientRects()[0]?.y;
      if (elementYPosition === undefined) {
        return false;
      }
      return elementYPosition >= MARGIN_ABOVE_EDITOR + HEADING_WIDTH;
    },
    [],
  );

  const scrollToNode = useCallback(
    (key: NodeKey, currIndex: number) => {
      editor.getEditorState().read(() => {
        const domElement = editor.getElementByKey(key);
        if (domElement !== null) {
          domElement.scrollIntoView();
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
        return 2;
      case "h3":
        return 4;
      case "h4":
        return 6;
      case "h5":
        return 8;
      case "h6":
        return 10;
      default:
        return 0;
    }
  }, []);

  useEffect(() => {
    function scrollCallback() {
      if (
        tableOfContents.length !== 0 &&
        selectedIndex.current < tableOfContents.length - 1
      ) {
        let currentHeading = editor.getElementByKey(
          tableOfContents[selectedIndex.current]?.[0] ?? "",
        );
        if (currentHeading !== null) {
          if (isHeadingBelowTheTopOfThePage(currentHeading)) {
            while (
              currentHeading !== null &&
              isHeadingBelowTheTopOfThePage(currentHeading) &&
              selectedIndex.current > 0
            ) {
              const prevHeading = editor.getElementByKey(
                tableOfContents[selectedIndex.current - 1]?.[0] ?? "",
              );
              if (
                prevHeading !== null &&
                (isHeadingAboveViewport(prevHeading) ||
                  isHeadingBelowTheTopOfThePage(prevHeading))
              ) {
                selectedIndex.current--;
              }
              currentHeading = prevHeading;
            }
            const prevHeadingKey =
              tableOfContents[selectedIndex.current]?.[0] ?? "";
            setSelectedKey(prevHeadingKey);
          } else if (isHeadingAboveViewport(currentHeading)) {
            while (
              currentHeading !== null &&
              isHeadingAboveViewport(currentHeading) &&
              selectedIndex.current < tableOfContents.length - 1
            ) {
              const nextHeading = editor.getElementByKey(
                tableOfContents[selectedIndex.current + 1]?.[0] ?? "",
              );
              if (
                nextHeading !== null &&
                (isHeadingAtTheTopOfThePage(nextHeading) ||
                  isHeadingAboveViewport(nextHeading))
              ) {
                selectedIndex.current++;
              }
              currentHeading = nextHeading;
            }
            const nextHeadingKey =
              tableOfContents[selectedIndex.current]?.[0] ?? "";
            setSelectedKey(nextHeadingKey);
          }
        }
      } else {
        selectedIndex.current = 0;
      }
    }
    let timerId: ReturnType<typeof setTimeout>;

    function debounceFunction(func: () => void, delay: number) {
      clearTimeout(timerId);
      timerId = setTimeout(func, delay);
    }

    function onScroll(): void {
      debounceFunction(scrollCallback, 10);
    }

    document.addEventListener("scroll", onScroll);
    return () => document.removeEventListener("scroll", onScroll);
  }, [
    tableOfContents,
    editor,
    isHeadingBelowTheTopOfThePage,
    isHeadingAboveViewport,
    isHeadingAtTheTopOfThePage,
  ]);

  return (
    <SidebarWrapper
      isOpen={isTocOpen}
      onClose={toggleToc}
      title="Table of Contents"
    >
      {tableOfContents.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No headings found.
        </p>
      ) : (
        <ul className="p-4">
          {tableOfContents.map(([key, text, tag], index) => (
            <li
              key={key}
              className={`relative pl-${headingToPadding(tag)} pr-4 py-1`}
            >
              <Button
                variant="link"
                onClick={() => scrollToNode(key, index)}
                className="p-0 text-foreground h-auto whitespace-normal text-left text-sm leading-snug hover:underline"
                title={text}
              >
                <span
                  className={`${selectedKey === key ? "font-semibold" : ""}`}
                >
                  {text.length > 35 ? `${text.substring(0, 35)}...` : text}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SidebarWrapper>
  );
}

function TocPluginWrapper() {
  const [editor] = useLexicalComposerContext();
  const { toggleToc } = useTocContext();

  useEffect(() => {
    return editor.registerCommand(
      TOGGLE_TOC_COMMAND,
      () => {
        toggleToc();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, toggleToc]);

  return (
    <LexicalTableOfContentsPlugin>
      {(tableOfContents) => {
        return <TableOfContentsList tableOfContents={tableOfContents} />;
      }}
    </LexicalTableOfContentsPlugin>
  );
}

export default TocPluginWrapper;
