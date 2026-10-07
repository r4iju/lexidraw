import type { LexicalEditor, NodeKey } from "lexical";
import { Fragment, useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLayoutClass } from "~/hooks/use-media-query";
import { placeFloating } from "~/lib/place-floating";
import { cn } from "~/lib/utils";
import type { BlockEntry } from "../block-search";

/** Where the slash is on screen, or null when it isn't drawn. */
function slashRect(
  editor: LexicalEditor,
  at: { key: NodeKey; offset: number },
): DOMRect | null {
  const text = editor.getElementByKey(at.key)?.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return null;
  const range = document.createRange();
  range.setStart(text, Math.min(at.offset, text.textContent?.length ?? 0));
  range.collapse(true);
  return range.getBoundingClientRect();
}

/**
 * The slash menu on screen: under the slash, or above it when there is no
 * room below, kept in the viewport; on a phone a sheet over the keyboard.
 * Grouped under headings until a query ranks the blocks instead.
 */
export function SlashMenuList({
  editor,
  at,
  entries,
  grouped,
  highlighted,
  onHighlight,
  onChoose,
}: {
  editor: LexicalEditor;
  at: { key: NodeKey; offset: number };
  entries: readonly BlockEntry[];
  grouped: boolean;
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (entry: BlockEntry) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const sheet = useLayoutClass() === "phone";
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;

  // Measures the slash and the menu in the DOM to place the menu.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element || sheet) return;
    const place = () => {
      const rect = slashRect(editor, at);
      if (!rect) return;
      const { left, top } = placeFloating(
        rect,
        { width: element.offsetWidth, height: element.offsetHeight },
        {
          top: 0,
          left: 0,
          right: document.documentElement.clientWidth,
          bottom: window.innerHeight,
        },
        { side: "below", align: "start", gap: 6 },
      );
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.visibility = "visible";
    };
    place();
    // Filtering changes the menu's height, which can flip it above the line.
    const resized = new ResizeObserver(place);
    resized.observe(element);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resized.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [editor, at, sheet]);

  // The editor keeps focus while the menu is open; assistive technology
  // follows the highlighted option through the editor's active descendant.
  useLayoutEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    root.setAttribute("aria-controls", `${id}-list`);
    root.setAttribute("aria-activedescendant", optionId(highlighted));
    return () => {
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    };
  });

  // Keeps the highlighted option in the menu's scrolled view.
  useEffect(() => {
    document
      .getElementById(optionId(highlighted))
      ?.scrollIntoView({ block: "nearest" });
  });

  const option = (entry: BlockEntry, index: number) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the editor keeps focus and handles the keys
    <div
      key={entry.id}
      id={optionId(index)}
      role="option"
      tabIndex={-1}
      aria-selected={index === highlighted}
      onMouseMove={() => index !== highlighted && onHighlight(index)}
      onClick={() => onChoose(entry)}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 select-none",
        sheet ? "h-11 text-base" : "py-1.5 text-label",
        index === highlighted && "bg-accent text-accent-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
      >
        {entry.icon}
      </span>
      <span className="truncate">{entry.label}</span>
    </div>
  );

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps the caret, and the keyboard, in the editor
    <div
      ref={menu}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "fixed z-50 overflow-y-auto overscroll-contain bg-popover p-1 text-popover-foreground",
        sheet
          ? "inset-x-0 bottom-(--keyboard-inset) max-h-[min(45vh,20rem)] border-t border-border pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
          : "invisible top-0 left-0 max-h-80 w-64 max-w-[calc(100vw-16px)] rounded-lg border border-border-subtle shadow-[var(--elevation-overlay)]",
      )}
    >
      <div id={`${id}-list`} role="listbox" aria-label="Blocks">
        {grouped
          ? groupsOf(entries).map(([group, members]) => (
              <Fragment key={group}>
                {/* biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role=group; a fieldset groups form controls */}
                <div
                  role="group"
                  aria-labelledby={`${id}-${group}`}
                  className="not-first:mt-1"
                >
                  <div
                    id={`${id}-${group}`}
                    className="px-2 pt-1.5 pb-1 text-caption font-medium text-muted-foreground"
                  >
                    {group}
                  </div>
                  {members.map(({ entry, index }) => option(entry, index))}
                </div>
              </Fragment>
            ))
          : entries.map(option)}
      </div>
    </div>,
    document.body,
  );
}

/** `entries` under their groups, in order, each with its place in the list. */
function groupsOf(entries: readonly BlockEntry[]) {
  const groups = new Map<string, { entry: BlockEntry; index: number }[]>();
  entries.forEach((entry, index) => {
    const members = groups.get(entry.group) ?? [];
    members.push({ entry, index });
    groups.set(entry.group, members);
  });
  return [...groups];
}
