/** Public destinations of the media nodes, shared by web and native previews. */
export const MEDIA_LINK_BASES = {
  youtube: "https://www.youtube.com/watch?v=",
  tweet: "https://x.com/i/web/status/",
  figma: "https://www.figma.com/file/",
} as const;

export type MediaLinkType = keyof typeof MEDIA_LINK_BASES;

/**
 * The ids each provider can have something under, as pattern sources so the
 * iOS app's generated copy matches the same ids. Anything else is no link at
 * all: the provider would answer with its home page, or never answer.
 */
export const MEDIA_ID_PATTERNS = {
  youtube: "^[A-Za-z0-9_-]{11}$",
  tweet: "^[0-9]{1,20}$",
  figma: "^[0-9A-Za-z]{22,128}$",
} as const satisfies Record<MediaLinkType, string>;

/** The page a media node's id names, or undefined when it names none. */
export function mediaLink(type: MediaLinkType, id: string): string | undefined {
  return new RegExp(MEDIA_ID_PATTERNS[type]).test(id)
    ? MEDIA_LINK_BASES[type] + id
    : undefined;
}

/** Figma's embed of the file at `fileLink`, a link {@link mediaLink} made. */
export function figmaEmbedUrl(fileLink: string): string {
  const query = new URLSearchParams({ embed_host: "lexidraw", url: fileLink });
  return `https://www.figma.com/embed?${query}`;
}
