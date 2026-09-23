import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import env from "@packages/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

const handler = async (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({ headers: new Headers(req.headers) }),
    // A 500 reaches the client with its message replaced, so the original
    // only survives here.
    onError: ({ path, error }) => {
      if (
        error.code === "INTERNAL_SERVER_ERROR" ||
        env.NODE_ENV === "development"
      ) {
        console.error(
          `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
        );
      }
    },
  });

export { handler as GET, handler as POST };
