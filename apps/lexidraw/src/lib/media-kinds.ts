/**
 * What a document may carry of one kind, as its upload is signed for: the
 * types, the largest size, and how a refusal names them.
 */
export type MediaKind<Type extends string> = {
  noun: "Image" | "Video";
  types: readonly Type[];
  maxBytes: number;
  allowed: string;
  max: string;
};

export const IMAGE = {
  noun: "Image",
  types: [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/webp",
    "image/avif",
  ],
  maxBytes: 10 * 1024 * 1024,
  allowed: "PNG, JPEG, SVG, WEBP, AVIF",
  max: "10MB",
} as const satisfies MediaKind<string>;

export const VIDEO = {
  noun: "Video",
  types: ["video/mp4", "video/webm", "video/ogg"],
  maxBytes: 100 * 1024 * 1024,
  allowed: "MP4, WEBM, OGG",
  max: "100MB",
} as const satisfies MediaKind<string>;
