import {
  $getRoot,
  $getState,
  $setState,
  createState,
  NODE_STATE_KEY,
  type SerializedEditorState,
} from "lexical";

/** One row of the header's properties list, in the order it was written. */
export type DocumentProperty = { key: string; value: string };

export type DocumentCover = {
  src: string;
  alt?: string;
  /** A CSS `object-position`, such as `50% 35%`, the crop keeps in view. */
  focus?: string;
};

/**
 * What a document shows around its title: everything but the title itself,
 * which is the entity's, and the language, which the document settings keep.
 */
export type DocumentHeader = {
  subtitle?: string;
  cover?: DocumentCover;
  properties?: DocumentProperty[];
  /** Whether a contents list of the H2 and H3 headings follows the header. */
  toc?: boolean;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * The header as stored, with anything malformed or empty dropped, so that a
 * header with nothing in it is `{}` and is not stored at all.
 */
export function normalizeDocumentHeader(value: unknown): DocumentHeader {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const header: DocumentHeader = {};
  const subtitle = text(raw.subtitle);
  if (subtitle) header.subtitle = subtitle;
  if (raw.cover && typeof raw.cover === "object") {
    const cover = raw.cover as Record<string, unknown>;
    const src = text(cover.src);
    if (src) {
      header.cover = { src };
      const alt = text(cover.alt);
      const focus = text(cover.focus);
      if (alt) header.cover.alt = alt;
      if (focus) header.cover.focus = focus;
    }
  }
  if (Array.isArray(raw.properties)) {
    const properties = raw.properties.flatMap((entry): DocumentProperty[] => {
      if (!entry || typeof entry !== "object") return [];
      const { key, value } = entry as Record<string, unknown>;
      return typeof key === "string" && key.trim() !== ""
        ? [{ key, value: typeof value === "string" ? value : "" }]
        : [];
    });
    if (properties.length > 0) header.properties = properties;
  }
  if (raw.toc === true) header.toc = true;
  return header;
}

const sameHeader = (a: DocumentHeader, b: DocumentHeader) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Kept on the root node, so the header saves, syncs and undoes with the content. */
export const documentHeaderState = createState("header", {
  parse: normalizeDocumentHeader,
  isEqual: sameHeader,
});

export function $getDocumentHeader(): DocumentHeader {
  return $getState($getRoot(), documentHeaderState);
}

export function $setDocumentHeader(header: DocumentHeader): void {
  $setState($getRoot(), documentHeaderState, normalizeDocumentHeader(header));
}

type RootWithState = SerializedEditorState["root"] & {
  [NODE_STATE_KEY]?: Record<string, unknown>;
};

/** {@link $getDocumentHeader} for a stored state, without an editor. */
export function documentHeaderOf(state: SerializedEditorState): DocumentHeader {
  return normalizeDocumentHeader(
    (state.root as RootWithState)[NODE_STATE_KEY]?.header,
  );
}

/** `state` holding `header`, without touching `state`. */
export function withDocumentHeader(
  state: SerializedEditorState,
  header: DocumentHeader,
): SerializedEditorState {
  const root = state.root as RootWithState;
  const { header: _previous, ...others } = root[NODE_STATE_KEY] ?? {};
  const normalized = normalizeDocumentHeader(header);
  const nodeState = sameHeader(normalized, {})
    ? others
    : { ...others, header: normalized };
  const { [NODE_STATE_KEY]: _state, ...rest } = root;
  return {
    ...state,
    root: {
      ...rest,
      ...(Object.keys(nodeState).length > 0
        ? { [NODE_STATE_KEY]: nodeState }
        : {}),
    } as SerializedEditorState["root"],
  };
}

/**
 * Titles the app gives a document nobody has named yet. A leading `# X` in
 * imported markdown may name such a document.
 */
const PLACEHOLDER_TITLES = new Set(["", "untitled", "new document"]);

export const isUntitled = (title: string): boolean =>
  PLACEHOLDER_TITLES.has(title.trim().toLowerCase());

/** Two titles are the same when they read the same. */
export const sameTitle = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, " ").toLowerCase() ===
  b.trim().replace(/\s+/g, " ").toLowerCase();
