/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { Glob } from "bun";
import { reactCompiler } from "../../react-compiler";

// Next compiles client code with its own bundled Babel; there are no types.
const require = createRequire(import.meta.url);
const babel = require("next/dist/compiled/babel/core");
const { loadBindings } = require("next/dist/build/swc");
const typescript = require.resolve(
  "next/dist/compiled/babel/preset-typescript",
);

const APP = new URL("../..", import.meta.url).pathname;

/** React calls a component or a hook during render, and nothing else. */
const RENDERED = /^(?:[A-Z]|use[A-Z0-9])/;

// biome-ignore lint/suspicious/noExplicitAny: Babel's NodePath, untyped here
type Path = any;

const WRAPPERS = new Set(["memo", "forwardRef"]);

/** A function's name, or null when it's an unnamed component. */
function nameOf(fn: Path): string | null {
  if (fn.node.id) return fn.node.id.name;
  let parent = fn.parentPath;
  let wrapped = false;
  // memo(forwardRef(function (props, ref) { ... }))
  while (parent?.isCallExpression()) {
    const { callee } = parent.node;
    const name =
      callee.type === "MemberExpression" ? callee.property.name : callee.name;
    wrapped ||= WRAPPERS.has(name);
    parent = parent.parentPath;
  }
  if (parent?.isVariableDeclarator() && parent.node.id.type === "Identifier") {
    return parent.node.id.name;
  }
  return wrapped ? null : "<anonymous>";
}

/**
 * Runs after the compiler and names every function it gave a memo cache:
 * `const $ = _c(n)`, where `_c` is `useMemoCache`, a hook.
 */
function memoizedFunctions(found: (string | null)[]) {
  return {
    visitor: {
      Program: {
        exit(program: Path) {
          // The compiler adds this import without registering a scope
          // binding, so it is read off the declaration.
          const cache = new Set<string>();
          for (const statement of program.node.body) {
            if (
              statement.type === "ImportDeclaration" &&
              statement.source.value === "react/compiler-runtime"
            ) {
              for (const specifier of statement.specifiers) {
                cache.add(specifier.local.name);
              }
            }
          }
          if (cache.size === 0) return;
          program.traverse({
            CallExpression(call: Path) {
              const { callee } = call.node;
              if (callee.type !== "Identifier" || !cache.has(callee.name)) {
                return;
              }
              const fn = call.getFunctionParent();
              if (fn) found.push(nameOf(fn));
            },
          });
        },
      },
    },
  };
}

describe("React Compiler", () => {
  // A memo cache is a hook, so a helper that gets one throws "Invalid hook
  // call" whenever it runs outside render: from an event handler, an effect,
  // or a callback React invokes itself, such as useSyncExternalStore's
  // subscribe. That broke the editor's right-click menu in production.
  test(
    "memoizes components and hooks only",
    async () => {
      const { reactCompiler: swc } = await loadBindings();
      // Next's own pre-check: a file without JSX or a `useX()` call never
      // reaches the compiler, whatever its directives say.
      const compilerRequired = (path: string): Promise<boolean> =>
        swc.isReactCompilerRequired(path);
      const offenders: string[] = [];
      for (const file of new Glob("src/**/*.{ts,tsx}").scanSync(APP)) {
        if (file.endsWith(".d.ts") || file.includes(".test.")) continue;
        if (!(await compilerRequired(`${APP}/${file}`))) continue;
        const found: (string | null)[] = [];
        babel.transformSync(readFileSync(`${APP}/${file}`, "utf8"), {
          filename: file,
          babelrc: false,
          configFile: false,
          code: false,
          presets: [
            [typescript, { allExtensions: true, isTSX: file.endsWith(".tsx") }],
          ],
          plugins: [
            [
              require.resolve("babel-plugin-react-compiler"),
              {
                ...reactCompiler,
                // Server and unreachable files pass through here too; `next
                // build` is what fails on a compiler error in shipped code.
                panicThreshold: "none",
                // As `next dev` does: every compiled function gets a cache,
                // even one a production build would leave without.
                environment: { enableResetCacheOnSourceFileChanges: true },
              },
            ],
            memoizedFunctions(found),
          ],
        });
        for (const name of found) {
          if (name !== null && !RENDERED.test(name)) {
            offenders.push(`${relative(APP, `${APP}/${file}`)}: ${name}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
    { timeout: 120_000 },
  );
});
