import { usageError } from "./errors";

export type ArgSpec = {
  /** Flags that consume a value, as `--name value` or `--name=value`. */
  value: readonly string[];
  /** Flags that stand alone. */
  boolean: readonly string[];
};

export type ParsedArgs = {
  positionals: string[];
  /** Every occurrence of a value flag, in the order they were given. */
  values: Record<string, string[]>;
  booleans: Set<string>;
};

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const positionals: string[] = [];
  const values: Record<string, string[]> = {};
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);

    if (spec.boolean.includes(name)) {
      if (inline !== undefined) {
        throw usageError(`--${name} does not take a value`);
      }
      booleans.add(name);
      continue;
    }
    if (!spec.value.includes(name)) {
      throw usageError(`unknown flag --${name}`);
    }
    if (inline === undefined) index += 1;
    const value = inline ?? argv[index];
    if (value === undefined) {
      throw usageError(`--${name} needs a value`);
    }
    const collected = values[name] ?? [];
    collected.push(value);
    values[name] = collected;
  }

  return { positionals, values, booleans };
}

/** The single value of a flag that is not meant to repeat. */
export function one(args: ParsedArgs, name: string): string | undefined {
  const given = args.values[name];
  if (!given) return undefined;
  if (given.length > 1) {
    throw usageError(`--${name} was given more than once`);
  }
  return given[0];
}

/** The single value of a flag that counts something, from `min` up. */
export function integer(
  args: ParsedArgs,
  name: string,
  min: number,
): number | undefined {
  const given = one(args, name);
  if (given === undefined) return undefined;
  const value = Number(given);
  if (!Number.isInteger(value) || value < min) {
    throw usageError(
      `--${name} expects a whole number from ${min}, got "${given}"`,
    );
  }
  return value;
}

export function rejectExtra(args: ParsedArgs, after: number): void {
  const extra = args.positionals[after];
  if (extra !== undefined) {
    throw usageError(`unexpected argument "${extra}"`);
  }
}
