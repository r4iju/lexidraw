import type { MigrationExecutor } from "./file-migration-owner.js";
import {
  destination,
  decodeContentCell,
  quoteContentName,
  readFullParentContent,
  requireFullParentState,
  validateFullParentContentSource,
  validateFullParentContentCompletion,
  requireContentValue,
} from "./full-parent-content-destination-v1.js";
import type { TypedCell } from "./full-parent-content-destination-v1.js";
import { bridgeHistoricalDocumentArchives } from "./historical-document-archive-bridge-v1.js";
export type FullParentContentProfile = {
  kind: "synthetic-bb7-full-parent-document-content-v1";
};
export async function repeatFullParentDocumentContent(
  executor: MigrationExecutor,
): Promise<{ repeated: boolean }> {
  await validateFullParentContentCompletion(executor);
  return { repeated: true };
}
export async function convertFullParentDocumentContent(
  executor: MigrationExecutor,
  profile: FullParentContentProfile,
): Promise<{ repeated: boolean }> {
  if (profile.kind !== destination.profile)
    throw new Error("STOP_FULL_PARENT_CONTENT: profile");
  const completed = await executor.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='HistoricalDocumentContentConversionReceiptV1'",
  );
  if (completed.rows.length !== 0)
    return repeatFullParentDocumentContent(executor);
  await validateFullParentContentSource(executor);
  const captured = await readFullParentContent(executor);
  bridgeHistoricalDocumentArchives({
    rows: requireContentValue(
      captured.rows.HistoricalStructuralRawV1,
      "archives",
    ).filter((row) =>
      ["Document", "SharedDocument"].includes(
        String(decodeContentCell(requireContentValue(row[1], "archive table"))),
      ),
    ),
    shareUpdatedAt: destination.bridge.certifiedShareUpdatedAt,
  });
  const children = [
    "SharedEntities",
    "UploadedImages",
    "WebRTCAnswers",
    "WebRTCOffers",
  ];
  const receipt = "HistoricalDocumentContentConversionReceiptV1";
  const rebuilt = [
    "Entities",
    "SharedEntities",
    "Tags",
    "EntityTags",
    "UploadedImages",
    "WebRTCAnswers",
    "WebRTCOffers",
    receipt,
  ];
  for (const table of [...children, "Entities"])
    await executor.execute(`DROP TABLE ${quoteContentName(table)}`);
  for (const table of rebuilt) {
    const entry = destination.target.physical.master.find(
      (row) => row[0] === "table" && row[1] === table,
    );
    if (!entry || typeof entry[3] !== "string")
      throw new Error("STOP_FULL_PARENT_CONTENT: table declaration");
    await executor.execute(entry[3]);
  }
  for (const entry of destination.target.physical.master) {
    if (
      entry[0] === "index" &&
      rebuilt.includes(String(entry[2])) &&
      typeof entry[3] === "string"
    )
      await executor.execute(entry[3]);
  }
  const insert = async (table: string, rows: TypedCell[][]) => {
    const columns = requireContentValue(
      destination.target.orderedColumns[table],
      `columns ${table}`,
    );
    for (const row of rows)
      await executor.execute({
        sql: `INSERT INTO ${quoteContentName(table)} (${columns.map(quoteContentName).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        args: row.map(decodeContentCell),
      });
  };
  const entities = requireContentValue(captured.rows.Entities, "entities").map(
    (row) => {
      const old = Object.fromEntries(
        requireContentValue(
          captured.orderedColumns.Entities,
          "entity columns",
        ).map((column, index) => [
          column,
          requireContentValue(row[index], column),
        ]),
      );
      const id = String(
        decodeContentCell(requireContentValue(old.id, "entity id")),
      );
      const additions = destination.supply.entityKeyedAdditions.find(
        (entry) => entry.id === id,
      );
      if (!additions)
        throw new Error("STOP_FULL_PARENT_CONTENT: supply identity");
      const values = { ...old, ...additions.values };
      return requireContentValue(
        destination.target.orderedColumns.Entities,
        "target entity columns",
      ).map((column) => requireContentValue(values[column], column));
    },
  );
  await insert("Entities", entities);
  for (const table of children)
    await insert(table, requireContentValue(captured.rows[table], table));
  for (const row of requireContentValue(
    captured.rows.sqlite_sequence,
    "sequence",
  )) {
    const name = decodeContentCell(
      requireContentValue(row[0], "sequence name"),
    );
    if (name === "WebRTCAnswers" || name === "WebRTCOffers")
      await executor.execute({
        sql: "UPDATE sqlite_sequence SET seq=CAST(? AS INTEGER) WHERE name=?",
        args: [requireContentValue(row[1], "sequence INTEGER")[1], name],
      });
  }
  const emptyReceiptTarget = {
    ...destination.target,
    rows: { ...destination.target.rows, [receipt]: [] },
  };
  requireFullParentState(
    await readFullParentContent(executor),
    emptyReceiptTarget,
  );
  await insert(receipt, [destination.receipt.typedTuple]);
  requireFullParentState(
    await readFullParentContent(executor),
    destination.target,
  );
  return { repeated: false };
}
