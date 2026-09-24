export const appUrl = process.env.VISUAL_APP_URL ?? "http://localhost:3025";

if (new URL(appUrl).hostname !== "localhost")
  throw new Error("Visual snapshots only run against a local stack");
