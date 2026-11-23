import { mock } from "bun:test";

const mode = process.argv[2];
const calls: unknown[][] = [];
console.log = () => {};
console.error = (...args: unknown[]) => {
  calls.push(args);
};
const start = mock(async () => {});
mock.module("~/app/api/crons/cron-middleware", () => ({
  canRunCron: async () => true,
}));
mock.module("@packages/drizzle", () => ({ drizzle: {} }));
mock.module("~/server/auth/sign-in-rate-limit", () => ({
  purgeExpiredSignInAttempts: async () => {},
}));
mock.module("~/server/rooms/room-signaling", () => ({
  purgeRoomSignals: async () => {},
}));
mock.module("workflow/api", () => ({ start }));
mock.module("~/workflows/cleanup/cleanup-orphaned-blobs-workflow", () => ({
  cleanupOrphanedBlobsWorkflow: async () => {},
}));
mock.module("~/server/pro/image-runtime", () => ({
  generatedImages() {
    if (mode === "initialization") throw new Error("fixture private config");
    return {
      async cleanup() {
        throw new Error("fixture private query", {
          cause: { code: "SQLITE_BUSY" },
        });
      },
    };
  },
}));

const { GET } = await import("~/app/api/crons/bucket-cleanup/route");
const response = await GET();
process.stdout.write(
  JSON.stringify({
    calls,
    status: response.status,
    starts: start.mock.calls.length,
  }),
);
