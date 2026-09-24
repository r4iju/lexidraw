import type { Metadata } from "next";
import { entityTypeLabel } from "~/lib/entity-types";

const SITE_DESCRIPTION =
  "Write documents and sketch diagrams in one place. Rich text, slides and hand-drawn diagrams, shared with a link.";

/** What a link to any Lexidraw page shows when it is pasted somewhere. */
export const SITE_PREVIEW = {
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Lexidraw",
    title: "Lexidraw",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Lexidraw",
    description: SITE_DESCRIPTION,
  },
} satisfies Metadata;

/** Chat apps and search results cut a description off at about this length. */
const DESCRIPTION_LENGTH = 160;

/** The size the thumbnail workflow renders every entity at. */
const THUMBNAIL = { width: 640, height: 480 };

function clip(text: string, length: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  return `${(atWord.length > length / 2 ? atWord : cut).trimEnd()}…`;
}

/** `text` without `title` in front, as when a document opens with its heading. */
function withoutLeading(text: string, title: string) {
  return title && text.toLowerCase().startsWith(title.toLowerCase())
    ? text.slice(title.length).trimStart()
    : text;
}

/**
 * The preview of a file someone may open without signing in: its title, the
 * start of its text, and its light thumbnail. Only call it for a file the
 * public can read; a private file previews as the site.
 */
export function linkPreview({
  title,
  entityType,
  text,
  image,
}: {
  title: string;
  entityType: string;
  text?: string | null;
  image?: string | null;
}): Metadata {
  const body = withoutLeading(text?.trim() ?? "", title.trim());
  const description = body
    ? clip(body, DESCRIPTION_LENGTH)
    : `A ${entityTypeLabel(entityType).toLowerCase()} on Lexidraw.`;
  const images = image ? [{ url: image, ...THUMBNAIL, alt: title }] : undefined;
  return {
    description,
    openGraph: {
      ...SITE_PREVIEW.openGraph,
      type: "article",
      title,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      ...SITE_PREVIEW.twitter,
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}
