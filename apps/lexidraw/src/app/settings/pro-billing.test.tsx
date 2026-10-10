import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProBillingDetails } from "./pro-billing";
test("public coming soon and unavailable sandbox never offer a purchase; tester billing is distinct from capabilities", () => {
  const inactive = {
    environment: "sandbox" as const,
    available: false,
    monthlyUsd: 12,
    monthlyCredits: 1000,
    state: "none",
    cancelAtEnd: false,
    expiresAt: null,
    customerBound: false,
    source: null,
    appleAvailable: false,
  };
  const publicView = renderToStaticMarkup(
    <ProBillingDetails billing={inactive} eligible={false} />,
  );
  expect(publicView).toContain("Coming soon");
  expect(publicView).not.toContain("Buy sandbox");
  const absent = renderToStaticMarkup(
    <ProBillingDetails billing={inactive} eligible />,
  );
  expect(absent).toContain("Sandbox billing unavailable");
  const active = renderToStaticMarkup(
    <ProBillingDetails
      billing={{
        ...inactive,
        available: true,
        state: "active",
        expiresAt: 1793592000000,
        cancelAtEnd: true,
        customerBound: true,
      }}
      eligible
    />,
  );
  expect(active).toContain("Sandbox/test payment");
  expect(active).toContain("$12/month");
  expect(active).toContain("1,000 credits");
  expect(active).toContain("Ends at period expiry");
  expect(active).toContain("capability");
});
test("Apple lifecycle is labelled separately from web checkout with one shared allowance", () => {
  const html = renderToStaticMarkup(
    <ProBillingDetails
      eligible
      billing={{
        environment: "sandbox",
        available: false,
        monthlyUsd: 12,
        monthlyCredits: 1000,
        state: "active",
        cancelAtEnd: false,
        expiresAt: 1793592000000,
        customerBound: false,
        source: "apple",
        appleAvailable: false,
      }}
    />,
  );
  expect(html).toContain("Apple sandbox subscription");
  expect(html).toContain("internal iOS test build");
  expect(html).not.toContain("live purchase");
});
