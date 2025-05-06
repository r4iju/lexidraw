"use client";

import * as React from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

type TagsInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
};

const TagsInput = React.forwardRef<HTMLInputElement, TagsInputProps>(
  ({ className, value, onChange, ...props }, ref) => {
    const [pendingTag, setPendingTag] = React.useState("");

    // When the pendingTag includes a comma, split it into multiple tags.
    React.useEffect(() => {
      if (pendingTag.includes(",")) {
        const newTags = pendingTag
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        if (newTags.length) {
          const tagSet = new Set([...value, ...newTags]);
          onChange(Array.from(tagSet));
        }
        setPendingTag("");
      }
    }, [pendingTag, onChange, value]);

    // Add a single new tag
    const addTag = () => {
      const trimmed = pendingTag.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
      }
      setPendingTag("");
    };

    return (
      <div
        className={cn(
          "flex w-full min-h-10 flex-wrap gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
            "has-focus-visible:outline-hidden has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 " +
            "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {/* Render each tag as a Badge with a remove Button */}
        {value.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-2 h-3 w-3"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <XIcon className="h-3 w-3" />
            </Button>
          </Badge>
        ))}

        {/* The input for entering new tags */}
        <input
          ref={ref}
          value={pendingTag}
          onChange={(e) => setPendingTag(e.target.value)}
          onKeyDown={(e) => {
            // When pressing Enter or comma, finalize the current pending tag
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            } else if (
              e.key === "Backspace" &&
              pendingTag.length === 0 &&
              value.length > 0
            ) {
              // If backspace is pressed on an empty input, remove the last tag
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
          }}
          className="flex-1 outline-hidden placeholder:text-muted-foreground bg-transparent"
          placeholder="Enter values, comma separated..."
          {...props}
        />
      </div>
    );
  },
);

TagsInput.displayName = "TagsInput";

export { TagsInput };
