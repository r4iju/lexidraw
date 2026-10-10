import "server-only";
import { createClient } from "@libsql/client";
import env from "@packages/env";
import { revalidateEntities } from "../api/entity-cache";
import { DeviceAgentDocuments } from "./device-agent";
import { createDeviceAgentRouter } from "../api/routers/device-agent";
export const deviceAgentRouter = createDeviceAgentRouter(
  () =>
    new DeviceAgentDocuments(
      client(),
      Date.now,
      undefined,
      (document, parent) => revalidateEntities(document, parent),
    ),
);

let connection: ReturnType<typeof createClient> | undefined;
function client() {
  connection ??= createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
  });
  return connection;
}
