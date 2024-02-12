import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { drawingRouter } from "./routers/drawings";


export const appRouter = createTRPCRouter({
  auth: authRouter,
  drawings: drawingRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
