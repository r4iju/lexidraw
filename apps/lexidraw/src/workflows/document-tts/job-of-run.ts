import { and, eq, ne, schema } from "@packages/drizzle";

/** `docKey`'s job while `runId` still makes it, for a run's writes to it. */
export const jobOfRun = (docKey: string, runId: string) =>
  and(
    eq(schema.ttsJobs.id, docKey),
    eq(schema.ttsJobs.runId, runId),
    ne(schema.ttsJobs.status, "cancelled"),
  );
