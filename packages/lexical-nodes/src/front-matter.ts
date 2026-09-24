import { parseDocument } from "yaml";
import {
  type DocumentHeader,
  type DocumentProperty,
  isUntitled,
  normalizeDocumentHeader,
  sameTitle,
} from "./document-header.js";

/**
 * What a leading YAML block says about a document. `title` and `tags` are
 * the entity's and change only when given; the header and `lang` are what
 * the block describes as a whole, so a key it leaves out is cleared.
 */
export type FrontMatter = {
  /** The id a read wrote, recognised so it never becomes content. */
  id?: string;
  title?: string;
  tags?: string[];
  lang: string | null;
  header: DocumentHeader;
};

export type ReadFrontMatter = {
  frontMatter: FrontMatter | null;
  /** The markdown after the block, or all of it when there is none. */
  body: string;
  notes: string[];
};

const BLOCK = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Keys a read adds for reference; a write reads past them. */
const READ_ONLY_KEYS = new Set(["id", "path", "updatedAt"]);

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const scalar = (value: unknown): string | undefined =>
  typeof value === "string"
    ? value
    : typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      ? String(value)
      : undefined;

function propertyValue(
  key: string,
  value: unknown,
  notes: string[],
): string | null {
  if (value === null || value === undefined) return "";
  const single = scalar(value);
  if (single !== undefined) return single;
  if (Array.isArray(value) && value.every((item) => scalar(item) !== undefined))
    return value.map((item) => scalar(item)).join(", ");
  notes.push(
    `The front matter property "${key}" is not text or a list of text, so it was left out`,
  );
  return null;
}

function tagList(value: unknown, notes: string[]): string[] | undefined {
  const names = Array.isArray(value)
    ? value.map(scalar)
    : typeof value === "string"
      ? value.split(",")
      : null;
  if (!names || names.some((name) => name === undefined)) {
    notes.push(
      "The front matter tags are not a list of names, so the tags were left as they were",
    );
    return undefined;
  }
  return [
    ...new Set(
      (names as string[]).map((name) => name.trim()).filter((name) => name),
    ),
  ];
}

/**
 * Splits a leading YAML block off `markdown` and reads it. A block that is
 * not a YAML mapping is not front matter: it stays markdown, where `---`
 * reads as a rule, and a note says so.
 */
export function readFrontMatter(markdown: string): ReadFrontMatter {
  const match = BLOCK.exec(markdown);
  if (!match) return { frontMatter: null, body: markdown, notes: [] };
  const document = parseDocument(match[1] ?? "", { uniqueKeys: true });
  const contents: unknown =
    document.errors.length === 0 ? document.toJS({ mapAsMap: true }) : null;
  const empty = (match[1] ?? "").trim() === "";
  if (!(contents instanceof Map) && !empty) {
    const reason = document.errors[0]?.message.split("\n")[0];
    return {
      frontMatter: null,
      body: markdown,
      notes: [
        `The leading --- block is not YAML front matter${reason ? ` (${reason})` : ""}, so it was read as markdown`,
      ],
    };
  }
  const notes: string[] = [];
  const frontMatter: FrontMatter = { lang: null, header: {} };
  const properties: DocumentProperty[] = [];
  const cover: Record<string, string> = {};
  const addProperty = (key: string, value: unknown) => {
    const text = propertyValue(key, value, notes);
    if (text !== null) properties.push({ key, value: text });
  };
  for (const [rawKey, value] of contents instanceof Map ? contents : []) {
    const key = scalar(rawKey) ?? "";
    if (READ_ONLY_KEYS.has(key)) {
      if (key === "id" && typeof value === "string") frontMatter.id = value;
      continue;
    }
    switch (key) {
      case "title": {
        const title = scalar(value)?.trim();
        if (title) frontMatter.title = title;
        break;
      }
      case "tags": {
        const tags = tagList(value, notes);
        if (tags) frontMatter.tags = tags;
        break;
      }
      case "subtitle": {
        const subtitle = scalar(value)?.trim();
        if (subtitle) frontMatter.header.subtitle = subtitle;
        break;
      }
      case "cover":
        if (value instanceof Map) {
          for (const [part, text] of value) {
            const field = scalar(part);
            const content = scalar(text);
            if (
              content &&
              (field === "src" || field === "alt" || field === "focus")
            )
              cover[field] = content;
          }
        } else if (scalar(value)) {
          cover.src = scalar(value) as string;
        }
        break;
      case "cover_alt":
      case "cover_focus":
        if (scalar(value)) cover[key.slice(6)] = scalar(value) as string;
        break;
      case "lang": {
        const lang = scalar(value)?.trim() ?? "";
        if (LANGUAGE_TAG.test(lang)) frontMatter.lang = lang;
        else if (lang)
          notes.push(
            `The front matter lang "${lang}" is not a language tag such as en or ja, so the language is detected from the text`,
          );
        break;
      }
      case "toc":
        if (value === true || value === "true") frontMatter.header.toc = true;
        else if (value !== false && value !== "false" && value !== null)
          notes.push(
            "The front matter toc is not true or false, so no contents list was placed",
          );
        break;
      case "properties":
        if (value instanceof Map) {
          for (const [name, entry] of value) {
            const property = scalar(name);
            if (property) addProperty(property, entry);
          }
        } else if (value !== null) {
          notes.push(
            "The front matter properties are not a list of names and values, so they were left out",
          );
        }
        break;
      default:
        if (key) addProperty(key, value);
    }
  }
  if (cover.src) frontMatter.header.cover = cover as DocumentHeader["cover"];
  else if (cover.alt || cover.focus)
    notes.push(
      "The front matter has cover_alt or cover_focus without a cover, so no cover was set",
    );
  if (properties.length > 0) frontMatter.header.properties = properties;
  frontMatter.header = normalizeDocumentHeader(frontMatter.header);
  return {
    frontMatter,
    body: markdown.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, ""),
    notes,
  };
}

/** The entity fields a write may change, as the markdown sets them. */
export type DocumentFields = {
  title?: string;
  tags?: string[];
  /** A language tag, or null for the language detected from the text. */
  lang?: string | null;
};

export type MarkdownFields = {
  /** Only what the markdown sets; a field it leaves out is left as it is. */
  fields: DocumentFields;
  /** Whether the leading heading is the title, so it is not content too. */
  titleHeading: boolean;
  /** Whether that heading gave a document nobody had named its title. */
  namedByHeading: boolean;
};

/**
 * What markdown written into a document sets on it, the same for an import
 * in the editor and a write through the API: the title, tags and language
 * its front matter gives, and, where a leading `# X` can only be the title
 * (`titleFromHeading`: on a replace, or into an empty document), the title
 * that heading gives a document nobody has named.
 */
export function markdownFields(
  frontMatter: FrontMatter | null,
  heading: string,
  target: { title: string; titleFromHeading: boolean },
): MarkdownFields {
  const fields: DocumentFields = {};
  if (frontMatter) {
    if (frontMatter.title !== undefined) fields.title = frontMatter.title;
    if (frontMatter.tags !== undefined) fields.tags = frontMatter.tags;
    fields.lang = frontMatter.lang;
  }
  const title = fields.title ?? target.title;
  const titleHeading =
    target.titleFromHeading &&
    heading !== "" &&
    (isUntitled(title) || sameTitle(heading, title));
  const namedByHeading = titleHeading && isUntitled(title);
  if (namedByHeading) fields.title = heading;
  return { fields, titleHeading, namedByHeading };
}

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** A note naming what `frontMatter` set, for the writer to check. */
export function frontMatterNote(frontMatter: FrontMatter): string | null {
  const { header } = frontMatter;
  const applied = [
    frontMatter.title !== undefined && "the title",
    frontMatter.tags !== undefined && "the tags",
    header.subtitle && "the subtitle",
    header.cover && "the cover",
    frontMatter.lang && `the language (${frontMatter.lang})`,
    header.properties &&
      `${header.properties.length === 1 ? "1 property" : `${header.properties.length} properties`} (${header.properties.map((property) => property.key).join(", ")})`,
    header.toc && "a contents list",
  ].filter((item): item is string => Boolean(item));
  return applied.length > 0 ? `Front matter set ${list(applied)}` : null;
}

// JSON string literals are valid YAML double-quoted scalars, so values with
// colons, quotes, or hashes survive.
const quoted = (value: string) => JSON.stringify(value);

/** A key YAML reads back as this same string when written bare. */
const PLAIN_KEY = /^[\p{L}_][\p{L}\p{N}_ .()/-]*(?<! )$/u;
const RESERVED_KEY = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;

const yamlKey = (key: string) =>
  PLAIN_KEY.test(key) && !RESERVED_KEY.test(key) ? key : quoted(key);

export type FrontMatterFields = {
  id?: string;
  title: string;
  /** Slash-joined directory titles ending in the document title. */
  path?: string;
  updatedAt?: Date;
  tags: string[];
  /** The language a person or a write chose; a detected one is not written. */
  lang?: string | null;
  header: DocumentHeader;
};

/** The YAML block a read starts with, ending in its closing `---` line. */
export function writeFrontMatter(fields: FrontMatterFields): string {
  const { header } = fields;
  const lines = [
    "---",
    ...(fields.id !== undefined ? [`id: ${quoted(fields.id)}`] : []),
    `title: ${quoted(fields.title)}`,
    ...(fields.path !== undefined ? [`path: ${quoted(fields.path)}`] : []),
    ...(fields.updatedAt
      ? [`updatedAt: ${quoted(fields.updatedAt.toISOString())}`]
      : []),
    `tags: [${fields.tags.map(quoted).join(", ")}]`,
    ...(header.subtitle ? [`subtitle: ${quoted(header.subtitle)}`] : []),
    ...(header.cover
      ? [
          `cover: ${quoted(header.cover.src)}`,
          ...(header.cover.alt
            ? [`cover_alt: ${quoted(header.cover.alt)}`]
            : []),
          ...(header.cover.focus
            ? [`cover_focus: ${quoted(header.cover.focus)}`]
            : []),
        ]
      : []),
    ...(fields.lang ? [`lang: ${quoted(fields.lang)}`] : []),
    ...(header.toc ? ["toc: true"] : []),
    ...(header.properties
      ? [
          "properties:",
          ...header.properties.map(
            ({ key, value }) => `  ${yamlKey(key)}: ${quoted(value)}`,
          ),
        ]
      : []),
    "---",
  ];
  return `${lines.join("\n")}\n`;
}
