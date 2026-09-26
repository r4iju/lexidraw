import { expect, test } from "bun:test";
import { SCHEMA_NODES } from "./nodes.js";
import {
  STORED_BYTES_URL,
  type StoredCase,
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
