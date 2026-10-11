import { Buffer } from "node:buffer";
import {
  contentCanonical,
  decodeContentCell,
  destination,
  requireContentEqual,
  requireContentValue,
} from "./full-parent-content-destination-v1.js";
import type { TypedCell } from "./full-parent-content-destination-v1.js";
import { validateLegacyDocumentPayload } from "./legacy-document-conversion.js";

export type HistoricalDocumentBridgeInput = {
  rows: TypedCell[][];
  shareUpdatedAt: TypedCell;
};
export function validateHistoricalDocumentPayload(bytes: Uint8Array): void {
  validateLegacyDocumentPayload(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
}
export function bridgeHistoricalDocumentArchives(
  input: HistoricalDocumentBridgeInput,
) {
  requireContentEqual(
    input.rows.map(contentCanonical).sort(),
    destination.bridge.inputRows
      .map((row) => contentCanonical(row.typedArchiveTuple))
      .sort(),
    "exact selected archive BLOB tuples",
  );
  requireContentEqual(
    input.shareUpdatedAt,
    destination.bridge.certifiedShareUpdatedAt,
    "certified share addition",
  );
  const projection = (table: string): [number, TypedCell[]] => {
    const row = requireContentValue(
      input.rows.find(
        (row) =>
          decodeContentCell(requireContentValue(row[1], "archive table")) ===
          table,
      ),
      table,
    );
    const cell = requireContentValue(row[5], "archive BLOB");
    if (cell[0] !== "blob" || cell[1] === null)
      throw new Error("STOP_FULL_PARENT_CONTENT: archive envelope");
    const raw = Buffer.from(cell[1], "hex");
    const envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    ) as { version: number; values: TypedCell[] };
    return [envelope.version, envelope.values];
  };
  const Document = projection("Document");
  const payload = requireContentValue(Document[1][2], "document payload");
  if (payload[0] !== "text" || payload[1] === null)
    throw new Error("STOP_FULL_PARENT_CONTENT: document TEXT");
  validateHistoricalDocumentPayload(Buffer.from(payload[1], "hex"));
  return {
    Document,
    SharedDocument: projection("SharedDocument"),
    certifiedShareUpdatedAt: input.shareUpdatedAt,
  };
}
