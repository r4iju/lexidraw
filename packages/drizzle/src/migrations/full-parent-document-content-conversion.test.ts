import { expect } from "bun:test";
import sourceLiteral from "./fixtures/full-parent-document-converter-v1/source-completed-bb7-oracle.json";
import targetLiteral from "./fixtures/full-parent-document-converter-v1/target-typed-oracle.json";
import receiptLiteral from "./fixtures/full-parent-document-converter-v1/conversion-receipt-oracle.json";
import {
  convertFullParentDocumentContent,
  repeatFullParentDocumentContent,
} from "./full-parent-document-content-conversion.js";
import type { MigrationExecutor } from "./file-migration-owner.js";
import type {
  ContentState,
  TypedCell,
} from "./full-parent-content-destination-v1.js";
const source = sourceLiteral as unknown as ContentState;
const target = targetLiteral as unknown as ContentState;
const receipt = receiptLiteral as unknown as {
  orderedColumns: string[];
  typedTuple: TypedCell[];
};
export async function firstFullParentConversionCase(input: {
  executor: MigrationExecutor;
  inspect: (executor: MigrationExecutor) => Promise<unknown>;
  compare: (actual: unknown, expected: unknown, label: string) => void;
  record: (label: string, value: unknown) => void;
}) {
  const before = await input.inspect(input.executor);
  input.record("source-before", before);
  input.compare(before, source, "genuine bb7 source");
  const profile = {
    kind: "synthetic-bb7-full-parent-document-content-v1",
  } as const;
  input.record("call-input", { profile, executorSupplied: true });
  const result = await convertFullParentDocumentContent(
    input.executor,
    profile,
  );
  input.record("call-result", result);
  const after = await input.inspect(input.executor);
  input.record("target-after", after);
  input.compare(after, target, "complete conversion target");
  expect(
    (after as { rows: Record<string, unknown> }).rows
      .HistoricalDocumentContentConversionReceiptV1,
  ).toEqual([receipt.typedTuple]);
}

import { Buffer } from "node:buffer";
import {
  validateFullParentContentSource,
  validateFullParentContentCompletion,
  requireContentValue,
} from "./full-parent-content-destination-v1.js";
import type { FullParentContentCaseInput } from "./full-parent-content-test-support.js";

export async function sourceValidationCase(input: FullParentContentCaseInput) {
  const db = { executor: input.executor, owner: { write: input.write } };
  const { inspect, compare, record: save } = input;
  compare(
    await inspect(db.executor),
    source,
    "source validation genuine baseline",
  );
  const expected = structuredClone(source);
  const row = requireContentValue(
    requireContentValue(expected.rows.Users, "Users").find(
      (r) => r[0]?.[1] === "752d6f776e6572",
    ),
    "owner row",
  );
  row[
    requireContentValue(expected.orderedColumns.Users, "Users columns").indexOf(
      "name",
    )
  ] = ["text", "416c7465726564"];
  await db.executor.execute({
    sql: "UPDATE Users SET name=? WHERE id=?",
    args: ["Altered", "u-owner"],
  });
  const before = await inspect(db.executor);
  save("source-mutation-witness", before);
  compare(before, expected, "one cell independently authored parent mutation");
  let rejected = false;
  try {
    await validateFullParentContentSource(db.executor);
  } catch {
    rejected = true;
  }
  save("source-validation-result", { rejected });
  compare(
    await inspect(db.executor),
    expected,
    "source rejection unchanged complete state",
  );
  expect(rejected).toBe(true);
}

export async function damagedCompletionCase(input: FullParentContentCaseInput) {
  const db = { executor: input.executor, owner: { write: input.write } };
  const { inspect, compare, record: save } = input;
  compare(await inspect(db.executor), source, "completion genuine source");
  let emptyObserved = false;
  await db.owner.write(async (held) => {
    const executor: MigrationExecutor = {
      ...held,
      async execute(statement) {
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (
          sql.startsWith(
            'INSERT INTO "HistoricalDocumentContentConversionReceiptV1"',
          )
        ) {
          const actual = await inspect(held);
          compare(
            actual,
            {
              ...target,
              rows: {
                ...target.rows,
                HistoricalDocumentContentConversionReceiptV1: [],
              },
            },
            "independent full EMPTY receipt target",
          );
          save("empty-receipt-target", actual);
          emptyObserved = true;
        }
        return held.execute(statement);
      },
    };
    expect(
      await convertFullParentDocumentContent(executor, {
        kind: "synthetic-bb7-full-parent-document-content-v1",
      }),
    ).toEqual({ repeated: false });
  });
  expect(emptyObserved).toBe(true);
  const completed = await inspect(db.executor);
  compare(completed, target, "completion genuine completed baseline");
  save("completed-baseline", completed);
  expect(
    completed.orderedColumns.HistoricalDocumentContentConversionReceiptV1,
  ).toEqual(receipt.orderedColumns);
  expect(completed.rows.HistoricalDocumentContentConversionReceiptV1).toEqual([
    receipt.typedTuple,
  ]);
  const replacement = `sha256:${"0".repeat(64)}`;
  const expected = structuredClone(target);
  requireContentValue(
    requireContentValue(
      expected.rows.HistoricalDocumentContentConversionReceiptV1,
      "receipt rows",
    )[0],
    "receipt tuple",
  )[
    requireContentValue(
      expected.orderedColumns.HistoricalDocumentContentConversionReceiptV1,
      "receipt columns",
    ).indexOf("transformManifestIdentity")
  ] = ["text", Buffer.from(replacement).toString("hex")];
  await db.executor.execute({
    sql: "UPDATE HistoricalDocumentContentConversionReceiptV1 SET transformManifestIdentity=? WHERE profileId=?",
    args: [replacement, "synthetic-bb7-full-parent-document-content-v1"],
  });
  const before = await inspect(db.executor);
  compare(before, expected, "single damaged completed receipt cell");
  save("completion-mutation-witness", before);
  let rejected = false,
    writes = 0;
  const executor: MigrationExecutor = {
    ...db.executor,
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (/^(DROP|CREATE|INSERT|UPDATE|DELETE)\b/i.test(sql)) writes++;
      return db.executor.execute(statement);
    },
  };
  try {
    await validateFullParentContentCompletion(executor);
  } catch {
    rejected = true;
  }
  save("completion-result", { rejected, writes });
  compare(
    await inspect(db.executor),
    expected,
    "damaged completed target unchanged",
  );
  expect(writes).toBe(0);
  expect(rejected).toBe(true);
}

export async function exactRepeatCase(input: FullParentContentCaseInput) {
  const db = { executor: input.executor, owner: { write: input.write } };
  const { inspect, compare, record: save } = input;
  await db.owner.write((ex) =>
    convertFullParentDocumentContent(ex, {
      kind: "synthetic-bb7-full-parent-document-content-v1",
    }),
  );
  const before = await inspect(db.executor);
  compare(before, target, "repeat genuine completed baseline");
  save("repeat-before", before);
  const writes: string[] = [];
  const executor: MigrationExecutor = {
    ...db.executor,
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (/^(DROP|CREATE|INSERT|UPDATE|DELETE)\b/i.test(sql)) writes.push(sql);
      return db.executor.execute(statement);
    },
  };
  const result = await repeatFullParentDocumentContent(executor);
  save("repeat-result", { result, writes });
  compare(
    await inspect(db.executor),
    target,
    "repeat complete unchanged target",
  );
  expect(writes).toEqual([]);
  expect(result).toEqual({ repeated: true });
}
