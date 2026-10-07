import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import {
  Info,
  Lightbulb,
  type LucideIcon,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  $unwrapCallout,
  CALLOUT_KINDS,
  CALLOUT_LABELS,
  type CalloutKind,
  CalloutNode,
} from "@packages/lexical-nodes";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/** The Lucide icons document.css draws for each kind. */
const KIND_ICONS: Record<CalloutKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

const HEADER = ".callout > .callout-header";

/**
 * Makes an editable callout's header the button for its menu, and a
 * read-only one plain text again.
 */
function syncHeader(header: Element, editable: boolean) {
  if (!editable) {
    for (const name of ["role", "aria-haspopup", "aria-label"])
      header.removeAttribute(name);
    return;
  }
  const title = header.querySelector(".callout-title")?.textContent ?? "";
  header.setAttribute("role", "button");
  header.setAttribute("aria-haspopup", "dialog");
  header.setAttribute(
    "aria-label",
    `${title}: change the callout's kind or title`,
  );
}

function $calloutByKey(key: NodeKey) {
  const node = $getNodeByKey(key);
  return CalloutNode.$isCalloutNode(node) ? node : null;
}

type OpenMenu = { key: NodeKey; anchor: HTMLElement; kind: CalloutKind };

/**
 * A callout's icon and title open a menu, as a Notion callout's icon does:
 * pick a kind, edit the title, or remove the callout and keep its blocks.
 */
export default function CalloutMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  // Lexical's root, editable and callout mutation listeners.
  useEffect(() => {
    const syncAll = () => {
      const editable = editor.isEditable();
      for (const header of editor.getRootElement()?.querySelectorAll(HEADER) ??
        [])
        syncHeader(header, editable);
    };
    // Keeps the caret, and the editor's focus, where they were.
    const onMouseDown = (event: MouseEvent) => {
      if (
        editor.isEditable() &&
        event.target instanceof Element &&
        event.target.closest(HEADER)
      )
        event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const header =
        event.target instanceof Element ? event.target.closest(HEADER) : null;
      if (!(header instanceof HTMLElement) || !editor.isEditable()) return;
      const callout = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(header);
        return CalloutNode.$isCalloutNode(node)
          ? { key: node.getKey(), kind: node.getKind() }
          : null;
      });
      if (callout) setMenu({ ...callout, anchor: header });
    };
    return mergeRegister(
      editor.registerRootListener((root, previous) => {
        previous?.removeEventListener("mousedown", onMouseDown);
        previous?.removeEventListener("click", onClick);
        root?.addEventListener("mousedown", onMouseDown);
        root?.addEventListener("click", onClick);
      }),
      editor.registerEditableListener(syncAll),
      editor.registerMutationListener(
        CalloutNode,
        (mutations) => {
          const editable = editor.isEditable();
          for (const [key, mutation] of mutations) {
            if (mutation === "destroyed") continue;
            const header = editor
              .getElementByKey(key)
              ?.querySelector(":scope > .callout-header");
            if (header) syncHeader(header, editable);
          }
        },
        { skipInitialization: false },
      ),
    );
  }, [editor]);

  const anchor = useMemo(() => menu && { current: menu.anchor }, [menu]);
  // Popover closes itself whenever this changes identity. Modal, because the
  // editor takes focus back as an update commits, which would close it.
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setMenu(null);
  }, []);

  return (
    <Popover modal open={menu !== null} onOpenChange={onOpenChange}>
      {anchor && <PopoverAnchor virtualRef={anchor} />}
      {menu && (
        <CalloutMenu
          // A fresh title field for each callout the menu opens on.
          key={menu.key}
          editor={editor}
          menu={menu}
          onKind={(kind) => {
            editor.update(() => $calloutByKey(menu.key)?.setKind(kind));
            setMenu({ ...menu, kind });
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </Popover>
  );
}

function CalloutMenu({
  editor,
  menu,
  onKind,
  onClose,
}: {
  editor: LexicalEditor;
  menu: OpenMenu;
  onKind: (kind: CalloutKind) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const title = editor.read(() => $calloutByKey(menu.key)?.getTitle() ?? "");
  // Escape leaves the title as it was; anything else that ends editing it
  // keeps what was typed.
  const cancelled = useRef(false);
  const saveTitle = (value: string) => {
    if (cancelled.current) return;
    const next = value.trim();
    editor.update(() => {
      const callout = $calloutByKey(menu.key);
      if (callout && callout.getTitle() !== next) callout.setTitle(next);
    });
  };

  const onKindKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    const radios = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const index =
      event.target instanceof HTMLElement ? radios.indexOf(event.target) : -1;
    event.preventDefault();
    radios[(index + step + radios.length) % radios.length]?.focus();
  };

  return (
    <PopoverContent
      aria-label="Callout"
      sheet={false}
      align="start"
      className="flex w-64 flex-col gap-3 p-3"
      // Starts on the callout's own kind, as a radio group does.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement)
          event.currentTarget
            .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
            ?.focus();
      }}
      onEscapeKeyDown={() => {
        cancelled.current = true;
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        editor.focus();
      }}
    >
      <div
        role="radiogroup"
        aria-label="Kind"
        className="flex flex-col"
        onKeyDown={onKindKeyDown}
      >
        {CALLOUT_KINDS.map((kind) => {
          const Icon = KIND_ICONS[kind];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a menu row, not a native radio
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={kind === menu.kind}
              tabIndex={kind === menu.kind ? 0 : -1}
              onClick={() => onKind(kind)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-label hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                kind === menu.kind && "bg-accent",
              )}
            >
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0"
                style={{ color: `var(--callout-${kind})` }}
              />
              {CALLOUT_LABELS[kind]}
            </button>
          );
        })}
      </div>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          saveTitle(String(new FormData(event.currentTarget).get("title")));
          onClose();
        }}
      >
        <Label htmlFor={`${ids}-title`}>Title</Label>
        <Input
          id={`${ids}-title`}
          name="title"
          defaultValue={title}
          placeholder={CALLOUT_LABELS[menu.kind]}
          onBlur={(event) => saveTitle(event.currentTarget.value)}
        />
      </form>
      <Button
        type="button"
        name="remove"
        variant="ghost"
        size="sm"
        className="justify-start"
        onClick={() => {
          editor.update(() => {
            const callout = $calloutByKey(menu.key);
            if (callout) $unwrapCallout(callout);
          });
          onClose();
        }}
      >
        Remove callout
      </Button>
    </PopoverContent>
  );
}
