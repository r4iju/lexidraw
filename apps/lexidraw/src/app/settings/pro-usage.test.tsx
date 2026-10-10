import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProUsageDetails } from "./pro-trial";

test("private allowance clearly separates available, reserved, renewal, per-feature charges and cancellation policy", () => {
  const html = renderToStaticMarkup(
    <ProUsageDetails
      balance={{
        availableSubcredits: 999_998_475,
        reservedSubcredits: 1_792_000,
        previousPeriodReservedSubcredits: 0,
        renewalAt: 1791590400000,
        history: [
          {
            id: "one",
            feature: "text",
            state: "settled",
            quote: 1_792_000,
            charged: 1525,
            created_at: 1791504000000,
          },
        ],
        policy: {
          version: "private-cancellation-v1",
          disclosure:
            "Completed results are charged even after cancellation. Uncertain outcomes remain reserved.",
        },
      }}
    />,
  );
  expect(html).toContain("999.998475");
  expect(html).toContain("1.792");
  expect(html).toContain("0.001525");
  expect(html).toContain("Renewal");
  expect(html).toContain("Uncertain outcomes remain reserved");
});
