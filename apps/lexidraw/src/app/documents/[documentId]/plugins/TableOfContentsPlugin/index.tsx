import type { TableOfContentsEntry } from "@lexical/react/LexicalTableOfContentsPlugin";
import type { HeadingTagType } from "@lexical/rich-text";
import type { NodeKey } from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TableOfContentsPlugin as LexicalTableOfContentsPlugin } from "@lexical/react/LexicalTableOfContentsPlugin";
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { TableOfContents } from "lucide-react";

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
          // @ts-expect-error this is fine
          tableOfContents[selectedIndex.current][0],
        );
        if (currentHeading !== null) {
          if (isHeadingBelowTheTopOfThePage(currentHeading)) {
            //On natural scroll, user is scrolling up
            while (
              currentHeading !== null &&
              isHeadingBelowTheTopOfThePage(currentHeading) &&
              selectedIndex.current > 0
            ) {
              const prevHeading = editor.getElementByKey(
                // @ts-expect-error this is fine
                tableOfContents[selectedIndex.current - 1][0],
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
            // @ts-expect-error this is fine
            const prevHeadingKey = tableOfContents[selectedIndex.current][0];
            setSelectedKey(prevHeadingKey);
          } else if (isHeadingAboveViewport(currentHeading)) {
            //On natural scroll, user is scrolling down
            while (
              currentHeading !== null &&
              isHeadingAboveViewport(currentHeading) &&
              selectedIndex.current < tableOfContents.length - 1
            ) {
              const nextHeading = editor.getElementByKey(
                // @ts-expect-error this is fine
                tableOfContents[selectedIndex.current + 1][0],
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
            // @ts-expect-error this is fine
            const nextHeadingKey = tableOfContents[selectedIndex.current][0];
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
  }, [tableOfContents, editor]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="fixed top-[65px] right-20 z-10 rounded-lg shadow-lg"
        >
          <TableOfContents className="size-6" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-3  rounded-lg shadow-lg max-h-[80vh] overflow-y-auto">
        <ul>
          {tableOfContents.map(([key, text, tag], index) => (
            <li
              key={key}
              className={`relative pl-${headingToPadding(tag)} 
              
              `}
            >
              <Button
                variant="link"
                onClick={() => scrollToNode(key, index)}
                className="py-0 text-foreground"
              >
                <span className={`${selectedKey === key ? " underline" : ""}`}>
                  {text.length > 27 ? `${text.substring(0, 27)}...` : text}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default function TableOfContentsPlugin() {
  return (
    <LexicalTableOfContentsPlugin>
      {(tableOfContents) => {
        return <TableOfContentsList tableOfContents={tableOfContents} />;
      }}
    </LexicalTableOfContentsPlugin>
  );
}
