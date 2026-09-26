"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  httpBatchStreamLink,
  httpLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import type { AppRouter } from "~/server/api/root";
import transformer from "superjson";

export const api = createTRPCReact<AppRouter>();

const headers = () => ({ "x-trpc-source": "react" });

export function TRPCReactProvider(props: {
  children: React.ReactNode;
  headers?: Map<string, string>;
}) {
  const [queryClient] = useState(() => new QueryClient());

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        // loggerLink(),
        splitLink({
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({ transformer, url: "/api/trpc" }),
          false: splitLink({
            // See `MAX_DRAWING_FILE_BYTES`.
            condition: (op) => op.context.skipBatch === true,
            true: httpLink({ transformer, url: "/api/trpc", headers }),
            false: httpBatchStreamLink({
              transformer,
              url: "/api/trpc",
              headers,
            }),
          }),
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}
