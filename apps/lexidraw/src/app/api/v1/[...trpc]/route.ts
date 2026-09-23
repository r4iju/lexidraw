import env from "@packages/env";
import { createOpenApiFetchHandler } from "trpc-to-openapi";

import { appRouter } from "~/server/api/root";
import { createRestContext } from "~/server/api/trpc";

const handler = (req: Request) =>
  createOpenApiFetchHandler({
    endpoint: "/api/v1",
    req,
    router: appRouter,
    createContext: () =>
      createRestContext({ headers: new Headers(req.headers) }),
    // A 500 reaches the client with its message replaced, so the original
    // only survives here.
    onError: ({ path, error }) => {
      if (
        error.code === "INTERNAL_SERVER_ERROR" ||
        env.NODE_ENV === "development"
      ) {
        console.error(
          `❌ REST failed on ${path ?? "<no-path>"}: ${error.message}`,
        );
      }
    },
  });

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
