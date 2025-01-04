import {
  createTRPCRouter,
  protectedProcedureWithPermission,
} from "~/server/api/trpc";
import vercel from "../../../../vercel.json";

export const cronRouter = createTRPCRouter({
  list: protectedProcedureWithPermission("view_cron").query(async () => {
    return vercel.crons as { path: string; schedule: string }[];
  }),
});
