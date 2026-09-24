import { describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { isNextControlFlow } from "./next-control-flow";

/** What `headers()` rejects with once a prerender is complete. */
function prerenderInterrupt() {
  return Object.assign(
    new Error(
      "During prerendering, `headers()` rejects when the prerender is complete.",
    ),
    { digest: "HANGING_PROMISE_REJECTION" },
  );
}

describe("isNextControlFlow", () => {
  it("recognises a prerender interrupt, even inside a procedure's error", () => {
    expect(isNextControlFlow(prerenderInterrupt())).toBe(true);
    expect(
      isNextControlFlow(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          cause: prerenderInterrupt(),
        }),
      ),
    ).toBe(true);
  });

  it("recognises a redirect", () => {
    let thrown: unknown;
    try {
      redirect("/signin");
    } catch (error) {
      thrown = error;
    }
    expect(isNextControlFlow(thrown)).toBe(true);
  });

  it("leaves a real failure to be logged", () => {
    expect(isNextControlFlow(new Error("no such table: Tokens"))).toBe(false);
    expect(isNextControlFlow(new TRPCError({ code: "UNAUTHORIZED" }))).toBe(
      false,
    );
    expect(isNextControlFlow("a string")).toBe(false);
  });
});
