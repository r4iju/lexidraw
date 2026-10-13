import { expect, test } from "bun:test";
import literal from "./fixtures/full-parent-document-converter-v1/old-raw-codec-bridge-oracle.json";
import {
  bridgeHistoricalDocumentArchives,
  validateHistoricalDocumentPayload,
} from "./historical-document-archive-bridge-v1.js";

import type { TypedCell } from "./full-parent-content-destination-v1.js";
const oracle = literal as unknown as {
  inputRows: { typedArchiveTuple: TypedCell[] }[];
  certifiedShareUpdatedAt: TypedCell;
  expectedProjection: {
    Document: [number, TypedCell[]];
    SharedDocument: [number, TypedCell[]];
  };
};

test("old raw BLOB documents bridge to exact independently frozen projections", () => {
  const result = bridgeHistoricalDocumentArchives({
    rows: oracle.inputRows.map((row) => row.typedArchiveTuple),
    shareUpdatedAt: oracle.certifiedShareUpdatedAt,
  });
  expect(result).toEqual({
    ...oracle.expectedProjection,
    certifiedShareUpdatedAt: oracle.certifiedShareUpdatedAt,
  });
});

test("new accepting payload seam rejects duplicate decoded keys", () => {
  const bytes = new TextEncoder().encode(
    '{"root":{"type":"root","version":1,"children":[]},"unknown":{"k":1,"\\u006b":2}}',
  );
  expect(() => validateHistoricalDocumentPayload(bytes)).toThrow();
});
