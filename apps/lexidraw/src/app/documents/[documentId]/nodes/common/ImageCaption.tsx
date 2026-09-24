import { useEffect, useState } from "react";
import { $getRoot, type LexicalEditor } from "lexical";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import ContentEditable from "~/components/ui/content-editable";
import Placeholder from "~/components/ui/placeholder";
import { Button } from "~/components/ui/button";
import { XIcon } from "lucide-react";

interface ImageCaptionProps {
  caption: LexicalEditor;
  placeholder: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Take the caret, for a caption the writer has just switched on. */
  autoFocus: boolean;
  /** Editing aids for the caption, mounted only while the document is editable. */
  children: React.ReactNode;
  onHideCaption: () => void;
}

/**
 * Whether the caption was switched on since the media mounted. One that was
 * already on when the document opened must leave the caret alone, or opening
 * the document would scroll to it.
 */
export function useCaptionJustShown(shown: boolean): boolean {
  const [previous, setPrevious] = useState(shown);
  const [justShown, setJustShown] = useState(false);
  if (shown !== previous) {
    setPrevious(shown);
    setJustShown(shown);
  }
  return justShown;
}

function isBlank(caption: LexicalEditor): boolean {
  return caption
    .getEditorState()
    .read(() => $getRoot().getTextContent().trim() === "");
}

export default function ImageCaption({
  caption,
  placeholder,
  containerRef,
  autoFocus,
  children,
  onHideCaption,
}: ImageCaptionProps) {
  const isEditable = useLexicalEditable();
  const [isHovering, setIsHovering] = useState(false);
  const [blank, setBlank] = useState(() => isBlank(caption));

  useEffect(() => {
    setBlank(isBlank(caption));
    return caption.registerUpdateListener(() => setBlank(isBlank(caption)));
  }, [caption]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a");

      if (link && containerRef.current?.contains(link)) {
        event.preventDefault();
        event.stopPropagation();

        const url = link.getAttribute("href");
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("click", handleClick, true);
    }

    return () => {
      if (container) {
        container.removeEventListener("click", handleClick, true);
      }
    };
  }, [containerRef]);

  // A reader has nothing to see in a caption nobody wrote.
  if (!isEditable && blank) return null;

  return (
    <div ref={containerRef} className="document-caption [&_a]:cursor-pointer">
      <LexicalNestedComposer initialEditor={caption}>
        {isEditable && autoFocus && <AutoFocusPlugin />}
        {isEditable && children}
        <RichTextPlugin
          contentEditable={
            // biome-ignore lint/a11y/noStaticElementInteractions: image caption is interactive
            <div
              className="relative"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              <ContentEditable className="w-full min-h-[1.4em] p-0 font-normal" />
              {isEditable && isHovering && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0 mt-0.5 mr-0.5 z-20 size-8 text-muted-foreground hover:text-foreground"
                  onClick={onHideCaption}
                  aria-label="Hide caption"
                >
                  <XIcon className="size-5" />
                </Button>
              )}
            </div>
          }
          placeholder={(editable) =>
            editable ? (
              <Placeholder className="top-0 left-0 w-full text-center">
                {placeholder}
              </Placeholder>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalNestedComposer>
    </div>
  );
}
