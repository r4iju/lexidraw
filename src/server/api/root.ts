import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { drawingRouter } from "./routers/drawings";
import { elementRouter } from "./routers/elements";
import { appStateRouter } from "./routers/appstate";
import { snapshotRouter } from "./routers/snapshot";


export const appRouter = createTRPCRouter({
  auth: authRouter,
  drawings: drawingRouter,
  elements: elementRouter,
  appState: appStateRouter,
  snapshot: snapshotRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
