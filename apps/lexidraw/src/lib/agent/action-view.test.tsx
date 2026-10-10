import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentActionView } from "./action-view";
test("document action shows complete maximum, unavailable tools and each saved/incomplete edit without rollback claims", () => {
  const html = renderToStaticMarkup(
    <AgentActionView
      state={{
        kind: "result",
        operation: {
          id: "one",
          state: "refunded",
          charged: 0,
          quote: 26629334,
        },
        report: {
          status: "partial",
          completed: [{ revision: 2, description: "Saved paragraph" }],
          incomplete: ["Missing image"],
          reason: "Image tool unavailable",
        },
      }}
      onSubmit={() => {}}
      onAccept={() => {}}
      onCancel={() => {}}
      onDecline={() => {}}
    />,
  );
  expect(html).toContain("Saved paragraph");
  expect(html).toContain("Missing image");
  expect(html).toContain("Saved edits remain");
  expect(html).toContain("0 credits");
  const quote = renderToStaticMarkup(
    <AgentActionView
      state={{ kind: "quote", maximum: 26629334 }}
      onSubmit={() => {}}
      onAccept={() => {}}
      onCancel={() => {}}
      onDecline={() => {}}
    />,
  );
  expect(quote).toContain("26.629334");
  expect(quote).toContain("planning");
  expect(quote).toContain("search");
  expect(quote).toContain("Accept maximum");
});
