import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ColorPreset } from "~/components/ui/color-picker";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { formatShortcut } from "./toolbar";

/** A folded group in More: its label opens what the group offers. */
export function MoreSub({
  label,
  icon: Icon,
  children,
  disabled,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2" disabled={disabled}>
        {Icon && <Icon className="size-4" />}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ShortcutHint({ shortcut }: { shortcut: string }) {
  return (
    <DropdownMenuShortcut aria-hidden="true">
      {formatShortcut(shortcut).label}
    </DropdownMenuShortcut>
  );
}

export function ColourItems({
  value,
  presets,
  onChange,
}: {
  value: string;
  presets: ColorPreset[];
  onChange: (value: string, skipHistoryStack: boolean) => void;
}) {
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(next) => onChange(next, false)}
    >
      {[{ label: "Automatic", value: "" }, ...presets].map((preset) => (
        <DropdownMenuRadioItem
          key={preset.value || "automatic"}
          value={preset.value}
          className="gap-2"
        >
          <span
            aria-hidden="true"
            className="size-3.5 rounded-full border border-border"
            style={{ background: preset.value || undefined }}
          />
          {preset.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
