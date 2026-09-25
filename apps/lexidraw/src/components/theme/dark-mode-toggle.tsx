"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Suspense } from "react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

const THEMES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

/** Light, Dark and System, the current one checked. */
export function ThemeRadioItems() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      {THEMES.map(({ value, label, Icon }) => (
        <DropdownMenuRadioItem key={value} value={value} className="gap-2">
          <Icon className="size-4" aria-hidden />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export default function ModeToggle({ className }: { className?: string }) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Theme"
      title="Theme"
      className={cn("size-9", className)}
    >
      {/* The page's class says which is showing, from the first paint. */}
      <SunIcon className="size-5 dark:hidden" aria-hidden />
      <MoonIcon className="hidden size-5 dark:block" aria-hidden />
    </Button>
  );
  return (
    // The menu closes when the address changes, which a page's prerendered
    // frame cannot know; the frame shows the button and the menu follows.
    <Suspense fallback={button}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ThemeRadioItems />
        </DropdownMenuContent>
      </DropdownMenu>
    </Suspense>
  );
}
