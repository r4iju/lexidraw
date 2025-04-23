import type { ServerRuntime } from "next";

export const runtime: ServerRuntime = "edge";

export { GET, POST } from "~/server/auth";
