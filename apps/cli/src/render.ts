import { json, type Context } from "./context";
import { CliError, describe, usageError } from "./errors";

/**
 * A render as the REST path answers it. The file travels in the JSON body,
 * base64 encoded unless it is text, because that path is JSON only; see the
 * procedures' descriptions in the OpenAPI document.
 */
export type Rendered = {
  format: string;
  contentType: string;
  encoding: string;
  data: string;
};

/**
 * Raw bytes down a terminal are noise the shell then has to be reset from, so
 * a render that is bytes has to be told where they go.
 */
export function refuseBytesToTerminal(
  context: Context,
  out: string | undefined,
  what: string,
): void {
  if (out === undefined && context.io.stdoutIsTty) {
    throw usageError(
      `${what} writes bytes: give --out <file>, or redirect stdout`,
    );
  }
}

/**
 * Writes the rendered file to `out`, and then `report` with the bytes written
 * as JSON on stdout; or, with no `out`, writes the file itself to stdout.
 */
export async function writeRender(
  context: Context,
  rendered: Rendered,
  out: string | undefined,
  report: Record<string, unknown>,
): Promise<void> {
  if (typeof rendered.data !== "string") {
    throw new CliError("BAD_RESPONSE", "the render carried no data");
  }
  const file =
    rendered.encoding === "base64"
      ? Buffer.from(rendered.data, "base64")
      : rendered.data;
  if (out === undefined) {
    if (typeof file === "string") return context.io.stdout(file);
    return context.io.stdoutBytes(file);
  }
  try {
    await Bun.write(out, file);
  } catch (cause) {
    throw new CliError(
      "WRITE_FAILED",
      `--out ${out} could not be written: ${describe(cause)}`,
    );
  }
  context.io.stdout(
    json({
      ...report,
      // What the file holds, not what the string counts: an SVG's characters
      // are UTF-16 units here and UTF-8 bytes on disk.
      bytes: Buffer.byteLength(file),
      out,
    }),
  );
}
