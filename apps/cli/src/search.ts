import { parseArgs, rejectExtra } from "./args";
import { type Context, json } from "./context";
import { CliError, usageError } from "./errors";
import { chooseFormat, entityTable } from "./format";
import { apiSession, callApi } from "./http";

export async function searchCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, { value: ["format"], boolean: [] });
  const query = args.positionals[0];
  if (query === undefined) {
    throw usageError("usage: lexidraw search <query> [--format json|table]");
  }
  rejectExtra(args, 1);
  const format = chooseFormat(args, ["json", "table"], "json");

  const rows = await callApi(apiSession(context), {
    method: "GET",
    path: "/entities/search",
    query: [["query", query]],
  });
  if (!Array.isArray(rows)) {
    throw new CliError(
      "BAD_RESPONSE",
      "GET /entities/search did not answer a list",
    );
  }
  context.io.stdout(format === "table" ? entityTable(rows) : json(rows));
}
