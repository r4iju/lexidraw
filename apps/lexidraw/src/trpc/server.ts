import "server-only";

import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { headers } from "next/headers";
import { cache } from "react";
import { appRouter, type AppRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { loggerLink } from "@trpc/client";
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
    // loggerLink({
    //   enabled: (opts) => {
    //     return (
    //       process.env.NODE_ENV === "development" || opts.direction === "down"
    //     );
    //   },
    // }),
    /**
     * Custom RSC link that lets us invoke procedures without using http requests. Since Server
     * Components always run on the server, we can just call the procedure as a function.
     */
    () =>
      ({ op }) =>
        observable((observer) => {
          console.log(`[tRPC] Starting procedure: ${op.path}`, {
            input: op.input,
            type: op.type,
          });

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
              console.log(`[tRPC] Success for procedure: ${op.path}`, {
                result: data,
              });
              observer.next({ result: { data } });
              observer.complete();
            })
            .catch((cause) => {
              console.error(`[tRPC] Error in procedure: ${op.path}`, {
                error: cause,
                input: op.input,
                stack: cause.stack,
                cause: cause.cause,
              });
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
