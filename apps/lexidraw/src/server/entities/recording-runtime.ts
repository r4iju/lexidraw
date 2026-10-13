import "server-only";
import { drizzle } from "@packages/drizzle";
import { findEntityWith, findReadableEntity } from "./readable";
import { GeneratedRecordings } from "./generated-recordings";
import { proLedger } from "../pro/runtime";
import { readNarrationText } from "../pro/narration-runtime";
import { createDeviceNarrationRouter } from "../api/routers/device-narration";
export const deviceNarrationRouter = createDeviceNarrationRouter({
  read: readNarrationText,
  records: () =>
    new GeneratedRecordings(proLedger().client, {
      now: Date.now,
      canEdit: async (account, document) => {
        const entity = await findEntityWith(drizzle, document, account, "edit");
        return !!entity && ["document", "url"].includes(entity.entityType);
      },
      canRead: async (account, document) =>
        !!(await findReadableEntity(drizzle, document, account)),
    }),
});
