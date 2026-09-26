import { join } from "node:path";
import type { SchemaDialect } from "~/server/api/schema-dialect";

const apps = join(import.meta.dir, "..", "..", "..");

/** The committed copies of the OpenAPI document, and who reads each. */
export const OPENAPI_COPIES: {
  reader: string;
  dialect: SchemaDialect;
  path: string;
}[] = [
  {
    reader: "the CLI's tests",
    dialect: "portable",
    path: join(apps, "cli/test/fixtures/openapi.json"),
  },
  {
    reader: "the iOS app's client generator",
    dialect: "type-list-nullables",
    path: join(apps, "ios/Sources/LexidrawKit/openapi.json"),
  },
];
