import { describe, expect, it } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { notFoundOr } from "./not-found";

/** What a server component's call rejects with when a procedure throws. */
function failed(code: TRPCError["code"]) {
  return TRPCClientError.from(
    new TRPCError({ code, message: "Entity not found" }),
  );
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("notFoundOr", () => {
  it("renders the 404 page for an entity that is missing or not the caller's", () => {
    expect(
      isHTTPAccessFallbackError(
        thrownBy(() => notFoundOr(failed("NOT_FOUND"))),
      ),
    ).toBe(true);
  });

  it("lets any other failure through unchanged", () => {
    for (const error of [
      failed("UNAUTHORIZED"),
      failed("INTERNAL_SERVER_ERROR"),
      new Error("boom"),
    ]) {
      expect(thrownBy(() => notFoundOr(error))).toBe(error);
    }
  });
});
