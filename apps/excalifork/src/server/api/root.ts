import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { drawingRouter } from "./routers/drawings";
import { snapshotRouter } from "./routers/snapshot";
import { webRtcRouter } from "./routers/web-rtc";


export const appRouter = createTRPCRouter({
  auth: authRouter,
  drawings: drawingRouter,
  snapshot: snapshotRouter,
  webRtc: webRtcRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
