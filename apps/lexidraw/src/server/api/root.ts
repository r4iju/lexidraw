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
import { adminLlmRouter } from "./routers/admin/llm";
import { adminUsersRouter } from "./routers/admin/users";
import { adminEntitiesRouter } from "./routers/admin/entities";
import { adminThumbnailJobsRouter } from "./routers/admin/thumbnail-jobs";
import { ttsRouter } from "./routers/tts";
import { llmRouter } from "./routers/llm";
import { documentRouter } from "./routers/documents";
import { backupsRouter } from "./routers/backups";
import { toolsRouter } from "./routers/tools";
import { sandboxRouter } from "./routers/sandbox";

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
  adminLlm: adminLlmRouter,
  adminUsers: adminUsersRouter,
  adminEntities: adminEntitiesRouter,
  adminThumbnailJobs: adminThumbnailJobsRouter,
  tts: ttsRouter,
  llm: llmRouter,
  documents: documentRouter,
  backups: backupsRouter,
  tools: toolsRouter,
  sandbox: sandboxRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
