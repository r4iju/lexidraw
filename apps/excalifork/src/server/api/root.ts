import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { entityRouter } from "./routers/entities";
import { snapshotRouter } from "./routers/snapshot";
import { webRtcRouter } from "./routers/web-rtc";


export const appRouter = createTRPCRouter({
  auth: authRouter,
  entities: entityRouter,
  snapshot: snapshotRouter,
  webRtc: webRtcRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
