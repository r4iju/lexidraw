import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import type { JSX } from "react";
import { cn } from "~/lib/utils";

export default function LexicalContentEditable({
  className,
  placeholder,
}: {
  className?: string;
  placeholder?: string;
}): JSX.Element {
  const placeholderText = placeholder ?? "";

  return (
    <ContentEditable
      className={cn(
        "border-none font-medium block relative outline-none p-2",
        className,
      )}
      placeholder={
        placeholderText
          ? (isEditable: boolean) =>
              isEditable ? (
                <div className="absolute top-2 left-2 text-muted-foreground pointer-events-none">
                  {placeholderText}
                </div>
              ) : null
          : null
      }
      aria-placeholder={placeholderText ?? undefined}
    />
  );
}
