import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
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
  children: React.ReactNode;
  onHideCaption: () => void;
}

export default function ImageCaption({
  caption,
  placeholder,
  containerRef,
  children,
  onHideCaption,
}: ImageCaptionProps) {
  const [isHovering, setIsHovering] = useState(false);

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

  return (
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 w-full z-10 [&_a]:cursor-pointer"
    >
      <LexicalNestedComposer initialEditor={caption}>
        {children}
        <RichTextPlugin
          contentEditable={
            // biome-ignore lint/a11y/noStaticElementInteractions: image caption is interactive
            <div
              className="relative"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              <ContentEditable className="border-none border border-muted-foreground bg-muted/50 backdrop-blur-md text-sm w-full min-h-[20px]" />
              {isHovering && (
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
          placeholder={
            <Placeholder className="text-muted-foreground text-sm">
              {placeholder}
            </Placeholder>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalNestedComposer>
    </div>
  );
}
