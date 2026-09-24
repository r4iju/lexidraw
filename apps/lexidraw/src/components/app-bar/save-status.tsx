"use client";

import { CheckIcon, CircleIcon, LoaderCircleIcon } from "lucide-react";
import { useSaveStatus } from "~/hooks/use-unsaved-changes";

const SAID = {
  saved: { label: "Saved", Icon: CheckIcon, spin: false },
  saving: { label: "Saving…", Icon: LoaderCircleIcon, spin: true },
  unsaved: { label: "Unsaved changes", Icon: CircleIcon, spin: false },
} as const;

/** Whether the open entity's edits are stored; nothing outside an editor. */
export function SaveStatus() {
  const status = useSaveStatus();
  if (!status) return null;
  const { label, Icon, spin } = SAID[status];
  return (
    <span
      role="status"
      data-save-status={status}
      title={label}
      className="flex shrink-0 items-center gap-1.5 px-1 text-sm text-muted-foreground"
    >
      <Icon
        aria-hidden
        className={
          spin
            ? "size-4 motion-safe:animate-spin"
            : status === "unsaved"
              ? "size-2.5 fill-current"
              : "size-4"
        }
      />
      {/* Phones keep the icon; the words are for everyone else. */}
      <span className="max-sm:sr-only whitespace-nowrap">{label}</span>
    </span>
  );
}
