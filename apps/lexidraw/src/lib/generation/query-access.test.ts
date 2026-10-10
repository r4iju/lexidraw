import { expect, test } from "bun:test";
import { queryAccess } from "./query-access";
test("failed refresh blocks new generation even with previously available data", () => {
  expect(
    queryAccess(
      {
        data: { available: true },
        error: new Error("offline"),
        isPending: false,
      },
      true,
      "Image capability",
    ),
  ).toEqual({
    kind: "error",
    message:
      "Image capability could not be loaded. Retry before starting a new action.",
  });
});
test("pending preference cannot supply a default provider, while disabled dependent queries do not keep checking", () => {
  const pending = { data: undefined, error: null, isPending: true };
  expect(queryAccess(pending, true, "AI power preference")).toEqual({
    kind: "loading",
    message: "Loading AI power preference…",
  });
  expect(queryAccess(pending, false, "Pro capability")).toEqual({
    kind: "disabled",
  });
  expect(
    queryAccess(
      { data: { available: true }, error: null, isPending: false },
      true,
      "Pro capability",
    ),
  ).toEqual({ kind: "ready", data: { available: true } });
});
