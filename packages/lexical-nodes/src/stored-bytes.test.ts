import { expect, test } from "bun:test";
import { SCHEMA_NODES } from "./nodes.js";
import {
  rerecorded,
  STORED_BYTES_URL,
  type StoredCase,
  storedBytesFile,
  storedBytesMismatches,
} from "./stored-fixtures.js";

const CASES: StoredCase[] = await Bun.file(STORED_BYTES_URL).json();
/** A case is named for the node it varies, as `type@place change`. */
const typeOf = ({ name }: StoredCase) => name.slice(0, name.indexOf("@"));
const TYPES = [...new Set(CASES.map(typeOf))];

test.each(TYPES)(
  "%s writes a stored node, as stored or odd, byte for byte as before",
  (type) => {
    const mismatches = storedBytesMismatches(
      SCHEMA_NODES,
      CASES.filter((stored) => typeOf(stored) === type),
    );

    expect(mismatches.map(({ name }) => name)).toEqual([]);
  },
);

test("the committed file is its cases as the re-recorder writes them, byte for byte", async () => {
  expect(storedBytesFile(CASES)).toBe(await Bun.file(STORED_BYTES_URL).text());
});

test("re-recording takes what the nodes write now for the cases named, and only those", () => {
  const [reordered, asStored] = [
    CASES.find(({ name }) => name === "emoji@7.0 keys reversed"),
    CASES.find(({ name }) => name === "emoji@7.0 as stored"),
  ];
  if (!reordered || !asStored) throw new Error("the emoji cases are gone");
  const stale = { ...reordered, output: [asStored.node, asStored.node] };
  const staleToo = { ...asStored, output: [reordered.node] };

  expect(rerecorded(SCHEMA_NODES, [stale, staleToo], [stale.name])).toEqual([
    reordered,
    staleToo,
  ]);
  expect(
    rerecorded(SCHEMA_NODES, [staleToo], [staleToo.name]).map(
      ({ output }) => output,
    ),
  ).toEqual([undefined]);
});
