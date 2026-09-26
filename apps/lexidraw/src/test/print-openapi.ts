// The generated OpenAPI document on stdout, so a test can assert on it from a
// process the env stubs never touch, indented the way `openapi:fixture` writes
// the copies. `--dialect=<name>` picks the spelling; portable by default.
import { parseArgs } from "node:util";
import { openApiDocumentIn } from "~/server/api/openapi";
import { SCHEMA_DIALECTS } from "~/server/api/schema-dialect";

const { values } = parseArgs({
  options: { dialect: { type: "string", default: "portable" } },
});
const dialect = SCHEMA_DIALECTS.find((known) => known === values.dialect);
if (!dialect) {
  throw new Error(`--dialect is one of ${SCHEMA_DIALECTS.join(", ")}`);
}

console.log(JSON.stringify(openApiDocumentIn(dialect), null, 2));
