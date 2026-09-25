"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $getDocumentHeader,
  $setDocumentHeader,
  type DocumentHeader as Header,
  type DocumentProperty,
  sameTitle,
} from "@packages/lexical-nodes";
import { $getRoot, type LexicalEditor, type NodeKey } from "lexical";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useImageUpload } from "~/hooks/use-media-upload";
import { propertyValueParts } from "~/lib/document-properties";
import { api } from "~/trpc/react";
import { scrollMotion } from "~/lib/scroll-motion";
import { CoverForm } from "./cover-form";

const sameJSON = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The header the document's root carries, kept current with the editor. */
function useDocumentHeader(editor: LexicalEditor) {
  const [header, setHeader] = useState<Header>(() =>
    editor.getEditorState().read($getDocumentHeader),
  );
  useEffect(() => {
    setHeader(editor.getEditorState().read($getDocumentHeader));
    return editor.registerUpdateListener(({ editorState }) => {
      const next = editorState.read($getDocumentHeader);
      setHeader((previous) => (sameJSON(previous, next) ? previous : next));
    });
  }, [editor]);
  const update = (change: (header: Header) => Header) =>
    editor.update(() => $setDocumentHeader(change($getDocumentHeader())));
  return [header, update] as const;
}

type OutlineEntry = { key: NodeKey; text: string; tag: "h2" | "h3" };

function $outline(): OutlineEntry[] {
  return $getRoot()
    .getChildren()
    .flatMap((child): OutlineEntry[] => {
      if (!$isHeadingNode(child)) return [];
      const tag = child.getTag();
      if (tag !== "h2" && tag !== "h3") return [];
      const text = child.getTextContent().trim();
      return text ? [{ key: child.getKey(), text, tag }] : [];
    });
}

function useOutline(editor: LexicalEditor, enabled: boolean): OutlineEntry[] {
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const next = editor.getEditorState().read($outline);
      setOutline((previous) => (sameJSON(previous, next) ? previous : next));
    };
    read();
    return editor.registerUpdateListener(read);
  }, [editor, enabled]);
  return enabled ? outline : [];
}

/**
 * The key of a leading `# title`: documents written before the title showed
 * above the content often start with one, and the title should read once.
 */
export function $titleHeadingKey(title: string): NodeKey | null {
  const first = $getRoot().getFirstChild();
  return $isHeadingNode(first) &&
    first.getTag() === "h1" &&
    sameTitle(first.getTextContent(), title)
    ? first.getKey()
    : null;
}

/** Hides a leading `# title` wherever it is, since the header shows it. */
function useHiddenTitleHeading(editor: LexicalEditor, title: string) {
  useEffect(() => {
    let hidden: HTMLElement | null = null;
    const apply = () => {
      const key = editor.getEditorState().read(() => $titleHeadingKey(title));
      const element = key ? editor.getElementByKey(key) : null;
      if (element === hidden) return;
      hidden?.removeAttribute("data-title-heading");
      element?.setAttribute("data-title-heading", "");
      hidden = element;
    };
    apply();
    const unregister = editor.registerUpdateListener(apply);
    return () => {
      unregister();
      hidden?.removeAttribute("data-title-heading");
    };
  }, [editor, title]);
}

type EditableTextProps = {
  value: string;
  editable: boolean;
  label: string;
  placeholder?: string;
  className: string;
  as?: "h1" | "p";
  autoFocus?: boolean;
  onCommit: (value: string) => void;
};

/**
 * Plain text edited in place: Enter or leaving the field keeps it, Escape
 * puts back what was there. Remounted when the value changes, so the text
 * the reader typed never fights the text React renders.
 */
function EditableText({
  value,
  editable,
  label,
  placeholder,
  className,
  as: Tag = "p",
  autoFocus,
  onCommit,
}: EditableTextProps) {
  const ref = useRef<HTMLHeadingElement & HTMLParagraphElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  if (!editable) return <Tag className={className}>{value}</Tag>;
  const commit = () => {
    const element = ref.current;
    if (!element) return;
    const next = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (next === value) element.textContent = value;
    else onCommit(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      ref.current?.blur();
    } else if (event.key === "Escape") {
      if (ref.current) ref.current.textContent = value;
      ref.current?.blur();
    }
  };
  return (
    <Tag
      key={value}
      ref={ref}
      className={className}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline="false"
      tabIndex={0}
      spellCheck
      data-placeholder={placeholder}
      onKeyDown={onKeyDown}
      onBlur={commit}
    >
      {value}
    </Tag>
  );
}

function subscribeNothing() {
  return () => {};
}

/**
 * A date in the reader's language. The server knows neither the reader's
 * locale nor zone, so it renders the ISO form and the browser swaps in the
 * local one after hydration.
 */
function PropertyDate({
  iso,
  date,
  withTime,
  lang,
}: {
  iso: string;
  date: Date;
  withTime: boolean;
  lang: string | undefined;
}) {
  const local = useSyncExternalStore(
    subscribeNothing,
    () =>
      new Intl.DateTimeFormat(lang || undefined, {
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" } : {}),
      }).format(date),
    () => null,
  );
  return <time dateTime={iso}>{local ?? iso}</time>;
}

function PropertyValue({
  property,
  lang,
}: {
  property: DocumentProperty;
  lang: string | undefined;
}) {
  return propertyValueParts(property.key, property.value).map((part, index) => {
    const key = `${index}-${part.kind}`;
    switch (part.kind) {
      case "status":
        return (
          <span
            key={key}
            className="document-status"
            data-status={part.text.toLowerCase()}
          >
            {part.text}
          </span>
        );
      case "mention":
        return (
          <span key={key} className="document-mention">
            @{part.name}
          </span>
        );
      case "link":
        return (
          <a key={key} href={part.href} target="_blank" rel="noreferrer">
            {part.text}
          </a>
        );
      case "date":
        return <PropertyDate key={key} {...part} lang={lang} />;
      default:
        return <span key={key}>{part.text}</span>;
    }
  });
}

function PropertyEditor({
  property,
  onDone,
}: {
  property: DocumentProperty;
  onDone: (property: DocumentProperty | null) => void;
}) {
  const [key, setKey] = useState(property.key);
  const [value, setValue] = useState(property.value);
  const row = useRef<HTMLFormElement>(null);
  const done = () => onDone(key.trim() ? { key: key.trim(), value } : null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    done();
  };
  return (
    <form
      ref={row}
      className="document-property"
      data-editing=""
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(property.key ? property : null);
      }}
      onBlur={(event) => {
        if (!row.current?.contains(event.relatedTarget as Node | null)) done();
      }}
    >
      <dt>
        <input
          // biome-ignore lint/a11y/noAutofocus: the row was opened to be edited
          autoFocus
          aria-label="Property name"
          placeholder="Name"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </dt>
      <dd>
        <input
          aria-label={`Value of ${key || "the property"}`}
          placeholder="Value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="document-header-action"
          onClick={() => onDone(null)}
        >
          Remove
        </button>
        <button type="submit" hidden />
      </dd>
    </form>
  );
}

function Properties({
  id,
  properties,
  editable,
  editsShown,
  lang,
  adding,
  onChange,
  onAdded,
}: {
  id: string;
  properties: DocumentProperty[];
  editable: boolean;
  /** Every row's Edit, where there is no pointer to show one row's. */
  editsShown: boolean;
  lang: string | undefined;
  adding: boolean;
  onChange: (properties: DocumentProperty[]) => void;
  onAdded: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const rows = adding ? [...properties, { key: "", value: "" }] : properties;
  const editingIndex = adding ? properties.length : editing;
  if (rows.length === 0) return null;
  const finish = (index: number, property: DocumentProperty | null) => {
    setEditing(null);
    if (adding) onAdded();
    const next = [...properties];
    if (property) next.splice(index, 1, property);
    else if (index < properties.length) next.splice(index, 1);
    if (!sameJSON(next, properties)) onChange(next);
  };
  return (
    <dl
      id={id}
      className="document-properties"
      data-edits-shown={(editable && editsShown) || undefined}
    >
      {rows.map((property, index) =>
        index === editingIndex ? (
          <PropertyEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its place in the list, as its name is being changed
            key={`editing-${index}`}
            property={property}
            onDone={(next) => finish(index, next)}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: two rows may carry the same name while one is renamed
          <div key={`${index}-${property.key}`} className="document-property">
            <dt>{property.key}</dt>
            <dd>
              <PropertyValue property={property} lang={lang} />
              {editable && (
                <button
                  type="button"
                  className="document-header-action document-property-edit"
                  aria-label={`Edit ${property.key}`}
                  onClick={() => setEditing(index)}
                >
                  Edit
                </button>
              )}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function Contents({
  editor,
  outline,
}: {
  editor: LexicalEditor;
  outline: OutlineEntry[];
}) {
  if (outline.length === 0) return null;
  return (
    <nav className="document-contents" aria-label="Contents">
      <p className="document-contents-label">Contents</p>
      <ol>
        {outline.map((entry) => (
          <li key={entry.key} data-level={entry.tag}>
            <a
              href={`#${entry.key}`}
              onClick={(event) => {
                event.preventDefault();
                editor.getElementByKey(entry.key)?.scrollIntoView({
                  block: "start",
                  behavior: scrollMotion(),
                });
              }}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

type DocumentHeaderProps = {
  entityId: string;
  title: string;
  /** The document's language, for dates in its properties. */
  lang: string | undefined;
  /** Whether the title may be renamed here: the reader's own screen. */
  canRename: boolean;
  fontFamily?: string;
};

/**
 * Renames the document. The page's other views of the title, such as the
 * breadcrumb and the tab, come from the server, so they follow a refresh.
 */
export function useRename(entityId: string, title: string) {
  const router = useRouter();
  const update = api.entities.update.useMutation();
  return (next: string, onFailure?: () => void) =>
    update.mutate(
      { id: entityId, title: next },
      {
        onSuccess: () => router.refresh(),
        onError: (error) => {
          onFailure?.();
          toast.error(`Couldn’t rename “${title}”. Try again.`, {
            description: error.message,
          });
        },
      },
    );
}

/** Replaces the document's tags with `names`, as markdown front matter does. */
export function useRetag(entityId: string, title: string) {
  const router = useRouter();
  const update = api.entities.updateEntityTags.useMutation();
  return (names: string[]) =>
    update.mutate(
      { id: entityId, tagNames: names },
      {
        onSuccess: () => router.refresh(),
        onError: (error) => {
          toast.error(`Couldn’t tag “${title}”. Try again.`, {
            description: error.message,
          });
        },
      },
    );
}

/**
 * Cover, title, subtitle, properties and contents, above the content and in
 * the same column. The title is the document's own; the rest lives on the
 * editor's root, so it saves, syncs and undoes with the content.
 */
export function DocumentHeader({
  entityId,
  title,
  lang,
  canRename,
  fontFamily,
}: DocumentHeaderProps) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [header, updateHeader] = useDocumentHeader(editor);
  const outline = useOutline(editor, header.toc === true);
  useHiddenTitleHeading(editor, title);
  const rename = useRename(entityId, title);
  const uploadImage = useImageUpload(entityId);
  const [shownTitle, setShownTitle] = useState(title);
  const [addingSubtitle, setAddingSubtitle] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);
  const [addingCover, setAddingCover] = useState(false);
  const [propertyEditsShown, setPropertyEditsShown] = useState(false);
  const propertiesId = useId();

  useEffect(() => setShownTitle(title), [title]);

  const commitTitle = (next: string) => {
    if (!next) return setShownTitle(title);
    setShownTitle(next);
    rename(next, () => setShownTitle(title));
  };

  const set = (change: Partial<Header>) =>
    updateHeader((current) => ({ ...current, ...change }));

  const { cover, subtitle, properties = [] } = header;
  const showSubtitle = Boolean(subtitle) || (editable && addingSubtitle);

  return (
    <header
      className="document-header"
      lang={lang || undefined}
      style={{ fontFamily }}
    >
      {cover && (
        <figure className="document-cover">
          <img
            src={cover.src}
            alt={cover.alt ?? ""}
            style={cover.focus ? { objectPosition: cover.focus } : undefined}
          />
          {editable && (
            <button
              type="button"
              className="document-header-action document-cover-remove"
              onClick={() => set({ cover: undefined })}
            >
              Remove cover
            </button>
          )}
        </figure>
      )}
      <EditableText
        as="h1"
        className="document-title"
        label="Title"
        value={shownTitle}
        editable={editable && canRename}
        onCommit={commitTitle}
      />
      {showSubtitle && (
        <EditableText
          className="document-subtitle"
          label="Subtitle"
          placeholder="Subtitle"
          value={subtitle ?? ""}
          editable={editable}
          autoFocus={addingSubtitle}
          onCommit={(next) => {
            setAddingSubtitle(false);
            set({ subtitle: next || undefined });
          }}
        />
      )}
      <Properties
        id={propertiesId}
        properties={properties}
        editable={editable}
        editsShown={propertyEditsShown}
        lang={lang}
        adding={editable && addingProperty}
        onAdded={() => setAddingProperty(false)}
        onChange={(next) => set({ properties: next })}
      />
      {header.toc && <Contents editor={editor} outline={outline} />}
      {editable && addingCover && (
        <CoverForm
          upload={uploadImage}
          onDone={(next) => {
            setAddingCover(false);
            if (next) set({ cover: next });
          }}
        />
      )}
      {editable && (
        <div className="document-header-actions">
          {!showSubtitle && (
            <button
              type="button"
              className="document-header-action"
              onClick={() => setAddingSubtitle(true)}
            >
              Add subtitle
            </button>
          )}
          {!cover && !addingCover && (
            <button
              type="button"
              className="document-header-action"
              onClick={() => setAddingCover(true)}
            >
              Add cover
            </button>
          )}
          {!addingProperty && (
            <button
              type="button"
              className="document-header-action"
              onClick={() => setAddingProperty(true)}
            >
              Add property
            </button>
          )}
          {properties.length > 0 && (
            <button
              type="button"
              className="document-header-action document-properties-toggle"
              aria-controls={propertiesId}
              aria-pressed={propertyEditsShown}
              onClick={() => setPropertyEditsShown((shown) => !shown)}
            >
              Edit properties
            </button>
          )}
          <button
            type="button"
            className="document-header-action"
            aria-pressed={header.toc === true}
            onClick={() => set({ toc: header.toc ? undefined : true })}
          >
            Contents list
          </button>
        </div>
      )}
    </header>
  );
}
