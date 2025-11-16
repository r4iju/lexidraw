import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { executeCodeInSandbox } from "~/server/llm/tools/code-execution";
import { ExecuteCodeSchema } from "@packages/types";

export const toolsRouter = createTRPCRouter({
  executeCode: protectedProcedure
    .input(ExecuteCodeSchema)
    .mutation(async ({ input }) => {
      const result = await executeCodeInSandbox(input);
      return result;
    }),
});
