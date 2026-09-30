import { createEmbedRenderer } from "./embedded-render";

type Preview = { png: string; width: number; height: number };

/** The original SVG remains the stored media; raster output is only its native preview. */
export function createSVGPreview(
  draw: (source: Uint8Array) => Promise<Preview>,
  revision?: string,
) {
  const render = createEmbedRenderer(async (request) => {
    const source = request.node.source;
    if (typeof source !== "string") throw new Error("Missing SVG source");
    return { ...(await draw(Buffer.from(source, "base64"))), svg: "" };
  }, revision);
  return async (source: Uint8Array) => {
    if (source.byteLength > 8_000_000)
      throw new Error("SVG source exceeds the image limit");
    const { svg: _, ...preview } = await render({
      node: { source: Buffer.from(source).toString("base64") },
      theme: "light",
      width: 2048,
      fontFamily: "none",
      fontSize: 1,
    });
    return preview;
  };
}
