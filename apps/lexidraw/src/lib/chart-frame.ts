/** Shared chart geometry for the document and native render endpoint. */
export function chartFrame(width: number | "inherit", height: number | "inherit", empty: boolean) {
  return {
    width: typeof width === "number" ? width : "100%",
    aspectRatio: empty ? undefined : typeof width === "number" && typeof height === "number" ? `${width} / ${height}` : "2 / 1",
  };
}
