// Rewrites every committed copy of the OpenAPI document; `openapi:fixture`
// runs it with the env stubbed.
import { openApiDocumentIn } from "~/server/api/openapi";
import { OPENAPI_COPIES } from "./openapi-copies";

for (const { dialect, path } of OPENAPI_COPIES) {
  await Bun.write(path, JSON.stringify(openApiDocumentIn(dialect), null, 2));
}
const format = Bun.spawnSync({
  cmd: [
    "bun",
    "x",
    "@biomejs/biome",
    "format",
    "--write",
    ...OPENAPI_COPIES.map((copy) => copy.path),
  ],
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(format.exitCode);
