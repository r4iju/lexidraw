import { ChevronDown, type LucideIcon, MoreHorizontal } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { IS_APPLE } from "../../shared/environment";
import { fitGroups } from "./fit-groups";

export type ToolbarGroup = {
  id: string;
  label: string;
  content: ReactNode;
  /** What the group offers from inside More once it no longer fits. */
  menu?: ReactNode;
};

const FOCUSABLE = "button, input, [role='combobox']";
/** A folded More button, measured once it has been shown. */
const MORE_WIDTH = 41;

function shortcutParts(shortcut: string) {
  return shortcut.split("+").map((key) => {
    switch (key) {
      case "Mod":
        return IS_APPLE ? ["Meta", "⌘"] : ["Control", "Ctrl"];
      case "Shift":
        return ["Shift", IS_APPLE ? "⇧" : "Shift"];
      case "Alt":
        return ["Alt", IS_APPLE ? "⌥" : "Alt"];
      default:
        return [key, key];
    }
  });
}

/** `Mod+B` as `aria-keyshortcuts` wants it, and as a person reads it. */
export function formatShortcut(shortcut: string) {
  const parts = shortcutParts(shortcut);
  return {
    aria: parts.map(([aria]) => aria).join("+"),
    label: parts.map(([, label]) => label).join(IS_APPLE ? "" : "+"),
  };
}

export function ToolbarTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {shortcut && (
          <kbd className="font-sans text-xs text-muted-foreground">
            {formatShortcut(shortcut).label}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolbarButton({
  label,
  shortcut,
  icon: Icon,
  pressed,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  icon?: LucideIcon;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <ToolbarTooltip label={label} shortcut={shortcut}>
      <Button
        type="button"
        variant={pressed ? "on" : "ghost"}
        size="icon"
        className={cn("size-8 shrink-0 pointer-coarse:size-11", className)}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut && formatShortcut(shortcut).aria}
        onClick={onClick}
        disabled={disabled}
      >
        {Icon ? <Icon /> : children}
      </Button>
    </ToolbarTooltip>
  );
}

/** A toolbar control that opens a menu; `trigger` is what it shows. */
export function ToolbarMenu({
  label,
  trigger,
  icon: Icon,
  children,
  disabled,
  className,
  contentClassName,
  align = "start",
  chevron = true,
}: {
  label: string;
  trigger?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  align?: "start" | "end";
  chevron?: boolean;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={label}
              className={cn(
                "h-8 shrink-0 gap-1 px-2 pointer-coarse:h-11",
                !trigger && "w-8 px-0 pointer-coarse:w-11",
                className,
              )}
            >
              {Icon && <Icon />}
              {trigger}
              {chevron && trigger && (
                <ChevronDown className="size-3! shrink-0 opacity-60" />
              )}
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align} className={contentClassName}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One row of grouped controls, a single tab stop that arrow keys move
 * through. Groups are in priority order; those that don't fit the space
 * available fold, from the end, into a More menu.
 */
export function Toolbar({
  label,
  groups,
  className,
  overflow = true,
}: {
  label: string;
  groups: ToolbarGroup[];
  className?: string;
  overflow?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);
  const moreWidth = useRef(MORE_WIDTH);
  const [shown, setShown] = useState(groups.length);

  const reachable = useCallback(() => {
    const root = bar.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) =>
        !element.closest("[inert]") && !(element as HTMLButtonElement).disabled,
    );
  }, []);

  const syncTabStop = useCallback(() => {
    const root = bar.current;
    if (!root) return;
    const controls = reachable();
    const stop =
      current.current && controls.includes(current.current)
        ? current.current
        : controls[0];
    for (const element of root.querySelectorAll<HTMLElement>(FOCUSABLE))
      element.tabIndex = element === stop ? 0 : -1;
  }, [reachable]);

  useLayoutEffect(() => {
    const root = bar.current;
    if (!root) return;
    syncTabStop();
    const observer = new MutationObserver(syncTabStop);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "inert"],
    });
    return () => observer.disconnect();
  }, [syncTabStop]);

  const measure = useCallback(() => {
    const root = bar.current;
    if (!root || !overflow) return;
    const widths = [
      ...root.querySelectorAll<HTMLElement>(":scope > [data-toolbar-group]"),
    ].map((group) => group.getBoundingClientRect().width);
    const more = root.querySelector<HTMLElement>(
      ":scope > [data-toolbar-more]",
    );
    if (more) moreWidth.current = more.getBoundingClientRect().width;
    setShown(fitGroups(widths, root.clientWidth, moreWidth.current));
  }, [overflow]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the observed group elements change with the groups
  useLayoutEffect(() => {
    const root = bar.current;
    if (!root || !overflow) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const group of root.querySelectorAll(":scope > [data-toolbar-group]"))
      observer.observe(group);
    return () => observer.disconnect();
  }, [measure, overflow, groups.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Events from menus opened here bubble through React, not the DOM.
    if (!bar.current?.contains(target)) return;
    const controls = reachable();
    const index = controls.indexOf(target);
    if (index < 0) return;
    if (target instanceof HTMLInputElement) {
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const atEnd = target.selectionStart === target.value.length;
      if (event.key === "ArrowLeft" && !atStart) return;
      if (event.key === "ArrowRight" && !atEnd) return;
      if (event.key === "Home" || event.key === "End") return;
    }
    const next = {
      ArrowRight: controls[(index + 1) % controls.length],
      ArrowLeft: controls[(index - 1 + controls.length) % controls.length],
      Home: controls[0],
      End: controls.at(-1),
    }[event.key];
    if (!next) return;
    event.preventDefault();
    current.current = next;
    syncTabStop();
    next.focus();
  };

  const folded = overflow ? groups.slice(shown) : [];

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={bar}
        role="toolbar"
        aria-label={label}
        aria-orientation="horizontal"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const target = event.target as HTMLElement;
          if (!bar.current?.contains(target) || !target.matches(FOCUSABLE))
            return;
          current.current = target;
          syncTabStop();
        }}
        className={cn(
          "ui-toolbar relative flex h-10 min-w-0 flex-1 flex-nowrap items-center overflow-hidden outline-none pointer-coarse:h-12",
          className,
        )}
      >
        {groups.map((group, index) => {
          const hidden = overflow && index >= shown;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a group of toolbar controls
            <div
              key={group.id}
              role="group"
              aria-label={group.label}
              data-toolbar-group={group.id}
              inert={hidden}
              aria-hidden={hidden || undefined}
              className={cn(
                "flex h-full w-max shrink-0 items-center gap-0.5 whitespace-nowrap",
                hidden && "pointer-events-none invisible absolute top-0 left-0",
              )}
            >
              {index > 0 && <Separator />}
              {group.content}
            </div>
          );
        })}
        {folded.length > 0 && (
          <div data-toolbar-more className="flex h-full shrink-0 items-center">
            <Separator />
            <ToolbarMenu label="More" icon={MoreHorizontal} align="end">
              {folded.map((group, index) => (
                <Fragment key={group.id}>
                  {index > 0 && <DropdownMenuSeparator />}
                  {group.menu}
                </Fragment>
              ))}
            </ToolbarMenu>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
  );
}
