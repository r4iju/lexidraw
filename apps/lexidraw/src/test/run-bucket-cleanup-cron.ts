import { mock } from "bun:test";

const mode = process.argv[2];
if (mode === "unconfigured") {
  delete process.env.PRIVATE_IMAGE_BLOB_READ_WRITE_TOKEN;
} else {
  process.env.PRIVATE_IMAGE_BLOB_READ_WRITE_TOKEN = "fixture-token";
}

const calls: unknown[][] = [];
const info: unknown[][] = [];
console.log = () => {};
console.info = (...args: unknown[]) => {
  info.push(args);
};
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
const generatedImages = mock(() => {
  if (mode !== "cleanup") throw new Error("fixture private config");
  return {
    async cleanup() {
      throw new Error("fixture private query", {
        cause: { code: "SQLITE_BUSY" },
      });
    },
  };
});
mock.module("~/server/pro/image-runtime", () => ({
  generatedImages,
}));

const { GET } = await import("~/app/api/crons/bucket-cleanup/route");
const response = await GET();
process.stdout.write(
  JSON.stringify({
    calls,
    info,
    imageInitializations: generatedImages.mock.calls.length,
    status: response.status,
    starts: start.mock.calls.length,
  }),
);
