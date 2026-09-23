import { parseArgs } from "./args";
import { COMMANDS, KNOWN_COMMANDS } from "./commands";
import { json, type Context } from "./context";
import { CliError, usageError } from "./errors";
import { extractOperation, loadDocument } from "./openapi";

export async function schemaCommand(
  context: Context,
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv, { value: [], boolean: ["list"] });

  if (args.booleans.has("list")) {
    context.io.stdout(
      json({
        commands: KNOWN_COMMANDS.map((command) => ({
          command,
          operationId: COMMANDS[command],
        })),
      }),
    );
    return;
  }

  // The name is two words, so it works quoted or as separate arguments.
  const command = args.positionals.join(" ").trim();
  if (command === "") {
    throw usageError(
      "usage: lexidraw schema <command> | lexidraw schema --list",
    );
  }
  const operationId = COMMANDS[command];
  if (operationId === undefined) {
    throw new CliError("UNKNOWN_COMMAND", `no command "${command}"`, {
      exitCode: 2,
      details: { known: KNOWN_COMMANDS },
    });
  }

  const document = await loadDocument({
    profile: context.profile.name,
    baseUrl: context.profile.baseUrl,
    refresh: context.refresh,
    env: context.io.env,
  });
  context.io.stdout(json(extractOperation(document, operationId, command)));
}
