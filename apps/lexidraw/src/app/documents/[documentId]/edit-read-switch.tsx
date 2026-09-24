"use client";

import { BookOpenIcon, PencilIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "~/lib/utils";

const MODES = [
  { reading: false, label: "Edit", Icon: PencilIcon },
  { reading: true, label: "Read", Icon: BookOpenIcon },
] as const;

/** Editing or reading, the current one marked; words from tablets up. */
export function EditReadSwitch({
  reading,
  onChange,
}: {
  reading: boolean;
  onChange: (reading: boolean) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex h-9 shrink-0 items-center rounded-md border border-border bg-background p-0.5">
      <legend className="sr-only">Mode</legend>
      {MODES.map(({ reading: value, label, Icon }) => {
        const checked = reading === value;
        return (
          <label
            key={label}
            title={label}
            className={cn(
              "flex h-full cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring",
              checked
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={checked}
              onChange={() => onChange(value)}
            />
            <Icon className="size-4" aria-hidden />
            <span className="max-md:sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
