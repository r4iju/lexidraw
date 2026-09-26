// The generated OpenAPI document on stdout, so a test can assert on it from a
// process the env stubs never touch, indented the way `openapi:fixture` keeps
// the CLI's copy. With `swift`, it is the iOS client's copy instead.
import { openApiDocument } from "~/server/api/openapi";
import { typeListNullables } from "~/server/api/type-list-nullables";

const document =
  process.argv[2] === "swift"
    ? typeListNullables(openApiDocument)
    : openApiDocument;

console.log(JSON.stringify(document, null, 2));
