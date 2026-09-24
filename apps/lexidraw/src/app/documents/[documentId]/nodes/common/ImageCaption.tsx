import { useEffect, useState } from "react";
import { $getRoot, type LexicalEditor } from "lexical";
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
  /** Editing aids for the caption, mounted only while the document is editable. */
  children: React.ReactNode;
  onHideCaption: () => void;
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
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 w-full z-10 [&_a]:cursor-pointer"
    >
      <LexicalNestedComposer initialEditor={caption}>
        {isEditable && children}
        <RichTextPlugin
          contentEditable={
            // biome-ignore lint/a11y/noStaticElementInteractions: image caption is interactive
            <div
              className="relative"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              <ContentEditable className="border-none border border-muted-foreground bg-muted/50 backdrop-blur-md text-sm w-full min-h-[20px]" />
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
              <Placeholder className="text-muted-foreground text-sm">
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
