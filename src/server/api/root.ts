import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { drawingRouter } from "./routers/drawings";
import { elementRouter } from "./routers/elements";


export const appRouter = createTRPCRouter({
  auth: authRouter,
  drawings: drawingRouter,
  elements: elementRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
