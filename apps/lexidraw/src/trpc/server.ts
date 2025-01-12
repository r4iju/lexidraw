import "server-only";

import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { headers } from "next/headers";
import { cache } from "react";
import { appRouter, type AppRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { loggerLink } from "./shared";
/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
  });
});

export const api = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    /**
     * Custom RSC link that lets us invoke procedures without using http requests. Since Server
     * Components always run on the server, we can just call the procedure as a function.
     */
    () =>
      ({ op }) =>
        observable((observer) => {
          createContext()
            .then((ctx) => {
              const caller = appRouter.createCaller(ctx);

              if (
                typeof caller[op.path as keyof typeof caller] === "function"
              ) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (caller as Record<string, any>)[op.path](op.input);
              } else {
                throw new Error(`Invalid procedure path: ${op.path}`);
              }
            })
            .then((data) => {
              observer.next({ result: { data } });
              observer.complete();
            })
            .catch((cause) => {
              observer.error(TRPCClientError.from(cause));
            });

          return () => {
            // should teardown for
            // - streaming
            // - subscriptions
            // - polling
          };
        }),
  ],
});
