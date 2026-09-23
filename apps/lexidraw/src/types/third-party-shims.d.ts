declare module "pdf-parse";
declare module "mammoth";
declare module "undici";

// Only `scripts/sync-excalidraw-fonts.ts` uses it, to decompress the editor's
// WOFF2 faces into the TrueType files resvg can read.
declare module "wawoff2" {
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
  export function compress(input: Uint8Array): Promise<Uint8Array>;
}
