import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import * as React from "react";
import { cn } from "~/lib/utils";

export default function LexicalContentEditable({
  className,
  placeholder,
  placeholderClassName,
}: {
  className?: string;
  placeholder?: string;
  placeholderClassName?: string;
}): React.JSX.Element {
  const placeholderText = placeholder ?? "";

  return (
    <ContentEditable
      className={cn(
        "relative border-none font-medium outline-hidden p-2 cursor-text",
        className,
      )}
      placeholder={(isEditable: boolean) =>
        isEditable && placeholderText ? (
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 left-2 text-muted-foreground pointer-events-none",
              placeholderClassName,
            )}
          >
            {placeholderText}
          </div>
        ) : null
      }
      aria-placeholder={placeholderText ?? undefined}
    />
  );
}
