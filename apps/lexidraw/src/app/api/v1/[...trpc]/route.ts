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
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ REST failed on ${path ?? "<no-path>"}: ${error.message}`,
            );
          }
        : undefined,
  });

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
