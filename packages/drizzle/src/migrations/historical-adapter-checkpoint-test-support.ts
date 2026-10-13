import { expect } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { preserveHistoricalPrefix } from "./historical-prefix-adapter";
import { bootstrap, inspect, canon } from "./historical-prefix-test-support";
import timestamps from "./fixtures/historical-prefix-v1/oracle.json";
import source from "./fixtures/historical-adapter-checkpoint-v1/source-completed-checkpoint-oracle.json";

export { inspect };
export type State = Awaited<ReturnType<typeof inspect>>;
export function compareState(actual: State, expected: State) {
  expect(actual.physical).toEqual(expected.physical);
  expect(Object.keys(actual.rows).sort()).toEqual(
    Object.keys(expected.rows).sort(),
  );
  for (const [table, rows] of Object.entries(expected.rows))
    expect((actual.rows[table] ?? []).map(canon).sort()).toEqual(
      rows.map(canon).sort(),
    );
}
export async function initialCheckpoint() {
  const { url } = await bootstrap();
  const client = createClient({ url, concurrency: 1, timeout: 0 });
  try {
    await client.execute("PRAGMA foreign_keys=ON");
    await client.execute("PRAGMA legacy_alter_table=OFF");
    expect(
      await preserveHistoricalPrefix(client, timestamps.timestamps),
    ).toEqual({ status: "preserved_prefix0003" });
    const state = await inspect(client);
    compareState(state, source as unknown as State);
    return { url, state };
  } finally {
    client.close();
  }
}
export async function reopen(url: string) {
  const client = createClient({ url, concurrency: 1, timeout: 0 });
  await client.execute("PRAGMA foreign_keys=ON");
  await client.execute("PRAGMA legacy_alter_table=OFF");
  return client;
}
