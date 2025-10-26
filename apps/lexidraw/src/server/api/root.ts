import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { entityRouter } from "./routers/entities";
import { snapshotRouter } from "./routers/snapshot";
import { webRtcRouter } from "./routers/web-rtc";
import { cronRouter } from "./routers/crons";
import { configRouter } from "./routers/config";
import { imageRouter } from "./routers/image";
import { webRouter } from "./routers/web";
import { articlesRouter } from "./routers/articles";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  crons: cronRouter,
  entities: entityRouter,
  snapshot: snapshotRouter,
  webRtc: webRtcRouter,
  config: configRouter,
  image: imageRouter,
  web: webRouter,
  articles: articlesRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
