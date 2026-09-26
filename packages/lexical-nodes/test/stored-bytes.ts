import { fileURLToPath } from "node:url";
import { SCHEMA_NODES } from "../src/nodes.js";
import {
  rerecorded,
  STORED_BYTES_URL,
  type StoredCase,
  storedBytesFile,
  storedBytesMismatches,
} from "../src/stored-fixtures.js";

// With no arguments, lists each case the nodes no longer save as recorded,
// with both saves. With `--rerecord` and case names, records what the nodes
// save now for those cases alone.
const cases: StoredCase[] = await Bun.file(STORED_BYTES_URL).json();
const [flag, ...names] = process.argv.slice(2);

if (flag === undefined) {
  for (const { name, expected, written } of storedBytesMismatches(
    SCHEMA_NODES,
    cases,
  )) {
    console.log(`${name}\n  recorded ${expected}\n  written  ${written}\n`);
  }
} else if (flag === "--rerecord" && names.length > 0) {
  const unknown = names.filter(
    (name) => !cases.some((stored) => stored.name === name),
  );
  if (unknown.length > 0) throw new Error(`No cases ${unknown.join(", ")}`);
  await Bun.write(
    fileURLToPath(STORED_BYTES_URL),
    storedBytesFile(rerecorded(SCHEMA_NODES, cases, names)),
  );
} else {
  throw new Error("Usage: bun run stored-bytes [--rerecord <case name>...]");
}
