import { parse } from "@babel/parser";
export async function basicTypeaheadPattern(
  trigger: string,
  minLength: number,
): Promise<string> {
  const source = await Bun.file(
    new URL(
      "../../lexidraw/node_modules/@lexical/react/src/LexicalTypeaheadMenuPluginUtils.ts",
      import.meta.url,
    ),
  ).text();
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const declarations = ast.program.body
    .filter((n) => n.type === "ExportNamedDeclaration")
    .map((n) => n.declaration)
    .filter(
      (n) =>
        n &&
        ((n.type === "FunctionDeclaration" &&
          n.id?.name === "useBasicTypeaheadTriggerMatch") ||
          (n.type === "VariableDeclaration" &&
            n.declarations.some(
              (d) => d.id.type === "Identifier" && d.id.name === "PUNCTUATION",
            ))),
    );
  if (declarations.length !== 2)
    throw new Error("Upstream trigger matcher changed");
  const code = declarations
    .map((n) => source.slice(n!.start!, n!.end!))
    .join("\n");
  let pattern = "";
  class ObservedRegExp extends RegExp {
    constructor(source: string, flags?: string) {
      super(source, flags);
      pattern = this.source;
    }
  }
  const matcher = new Function(
    "useCallback",
    "RegExp",
    new Bun.Transpiler({ loader: "ts" }).transformSync(code) +
      ";return useBasicTypeaheadTriggerMatch;",
  )((fn: unknown) => fn, ObservedRegExp)(trigger, { minLength });
  const probe = matcher(trigger + "smile");
  if (
    probe?.matchingString !== "smile" ||
    probe.replaceableString !== trigger + "smile" ||
    probe.leadOffset !== 0 ||
    !pattern
  )
    throw new Error("Upstream trigger result changed");
  return pattern;
}
