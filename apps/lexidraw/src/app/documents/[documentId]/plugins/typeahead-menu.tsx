import type { MenuOption } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useLayoutClass } from "~/hooks/use-media-query";
import { placeFloating } from "~/lib/place-floating";
import { cn } from "~/lib/utils";

/**
 * The menu under the caret that `:` and `@` open: one row per option, the
 * picture then the label, kept inside the viewport and flipped above the
 * line when there is no room below. On a phone it is a strip of chips above
 * the keyboard, over the editing bar.
 */
export function TypeaheadMenu<Option extends MenuOption>({
  anchor,
  label,
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  picture,
  name,
}: {
  anchor: HTMLElement | null;
  label: string;
  options: Option[];
  selectedIndex: number | null;
  onSelect: (option: Option, index: number) => void;
  onHighlight: (index: number) => void;
  picture: (option: Option) => ReactNode;
  name: (option: Option) => string;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const strip = useLayoutClass() === "phone";

  const place = useCallback(() => {
    const element = menu.current;
    if (!element || !anchor || strip) return;
    const caret = anchor.getBoundingClientRect();
    const { left, top } = placeFloating(
      caret,
      { width: element.offsetWidth, height: element.offsetHeight },
      {
        top: 0,
        left: 0,
        right: document.documentElement.clientWidth,
        bottom: window.innerHeight,
      },
      { side: "below", align: "start", gap: 4 },
    );
    // Measured from wherever `fixed` starts: a transformed ancestor moves it.
    element.style.left = "0px";
    element.style.top = "0px";
    const origin = element.getBoundingClientRect();
    element.style.left = `${left - origin.left}px`;
    element.style.top = `${top - origin.top}px`;
    element.style.visibility = "visible";
  }, [anchor, strip]);

  useLayoutEffect(place);
  // Lexical's anchor is the listbox the editor's aria-activedescendant points
  // into. It resets the anchor's aria-label on every render, so the name
  // comes through aria-labelledby, which wins and which Lexical leaves alone.
  const labelId = useId();
  useLayoutEffect(() => {
    anchor?.setAttribute("aria-labelledby", labelId);
    return () => anchor?.removeAttribute("aria-labelledby");
  }, [anchor, labelId]);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  if (!anchor || options.length === 0) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps the caret, and the keyboard, in the editor
    <div
      ref={menu}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "fixed z-50 bg-popover text-popover-foreground",
        strip
          ? "inset-x-0 bottom-(--keyboard-inset) flex h-[calc(2.75rem+env(safe-area-inset-bottom))] items-start gap-1 overflow-x-auto overscroll-x-contain border-t border-border px-2 pb-[env(safe-area-inset-bottom)] [scrollbar-width:none]"
          : "invisible max-h-72 w-max max-w-[min(20rem,calc(100vw-16px))] min-w-48 overflow-y-auto rounded-lg border border-border-subtle p-1 shadow-[var(--elevation-overlay)]",
      )}
    >
      <span id={labelId} hidden>
        {label}
      </span>
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the editor keeps focus and handles the keys
        <div
          key={option.key}
          ref={(element) => option.setRefElement(element)}
          id={`typeahead-item-${index}`}
          role="option"
          tabIndex={-1}
          aria-selected={selectedIndex === index}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onSelect(option, index)}
          className={cn(
            "flex cursor-default items-center gap-2 select-none",
            strip
              ? "h-11 min-w-11 shrink-0 justify-center rounded-full px-3 text-sm"
              : "rounded-sm px-2 py-1.5 text-label",
            selectedIndex === index && "bg-accent text-accent-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center"
          >
            {picture(option)}
          </span>
          <span className={cn("truncate", strip && "max-w-40")}>
            {name(option)}
          </span>
        </div>
      ))}
    </div>,
    anchor,
  );
}
