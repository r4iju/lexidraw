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
        "border-none font-medium block relative outline-none p-2 cursor-text",
        className,
      )}
      placeholder={(isEditable: boolean) =>
        isEditable && placeholderText ? (
          <div
            className={cn(
              "absolute top-2 left-2 text-muted-foreground pointer-events-none",
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
