import { expect, mock, test } from "bun:test";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RouterOutputs } from "~/trpc/shared";
import { PRICEBOOK, trialPolicy } from "~/server/pro/contracts";
import { button, installDom, render } from "~/test/dom";
import { renderToStaticMarkup } from "react-dom/server";
installDom();
let capability: Pick<
  UseQueryResult<RouterOutputs["pro"]["textCapability"]>,
  "data" | "error" | "isPending"
> = {
  data: { available: true, reason: "Fixture" },
  error: new Error("offline"),
  isPending: false,
};
const initialStatus: RouterOutputs["pro"]["status"] = {
  owner: false,
  publicState: "coming_soon",
  liveCheckout: false,
  paymentEnvironment: "disabled",
  billing: {
    environment: "sandbox",
    available: false,
    monthlyUsd: 12,
    monthlyCredits: 1000,
    state: "none",
    cancelAtEnd: false,
    expiresAt: null,
    customerBound: false,
    source: null,
    appleAvailable: false,
  },
  entitlementPeriodId: "fixture",
  pricebook: PRICEBOOK,
  providerCosts: {
    knownNanoUsd: 0,
    absorbedNanoUsd: 0,
    unknownExposureNanoUsd: 0,
  },
  eligible: true,
  entitled: true,
  availableSubcredits: 9000000,
  reservedSubcredits: 0,
  previousPeriodReservedSubcredits: 0,
  renewalAt: null,
  history: [],
  policy: trialPolicy(),
};
const status = { data: initialStatus, isError: false };
const mutation = () => ({ isPending: false, mutate() {}, data: undefined });
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    pro: {
      status: { useQuery: () => status },
      textCapability: { useQuery: () => ({ ...capability, refetch() {} }) },
      text: { useMutation: mutation },
      operation: { useQuery: () => ({ data: undefined }) },
      cancel: { useMutation: mutation },
      sandboxCheckout: { useMutation: mutation },
      sandboxManagement: { useMutation: mutation },
    },
  },
}));
const { ProTrialSection } = await import("./pro-trial");
test("failed cached text capability offers retry and blocks a new paid generation", () => {
  const html = renderToStaticMarkup(
    <ProTrialSection initialStatus={status.data} />,
  );
  expect(html).toContain("Pro text capability could not be loaded");
  expect(html).toContain("Retry");
  expect(html).not.toContain("Generate with private Pro");
  expect(html).not.toContain("Pro text is Coming soon");
});
test("pending text capability shows loading instead of claiming Coming soon", () => {
  capability = { data: undefined, error: null, isPending: true };
  const html = renderToStaticMarkup(
    <ProTrialSection initialStatus={status.data} />,
  );
  expect(html).toContain("Loading Pro text capability");
  expect(html).not.toContain("Pro text is Coming soon");
  expect(html).not.toContain("Generate with private Pro");
});

test("text admission and disclosures use the doubled durable period pricebook at the exact available-balance boundary", async () => {
  capability = {
    data: { available: true, reason: "Fixture" },
    error: null,
    isPending: false,
  };
  const doubled = {
    ...PRICEBOOK,
    version: "doubled-period",
    inputNanoUsd: 1500,
    cachedInputNanoUsd: 150,
    outputNanoUsd: 9000,
  };
  status.data = {
    ...initialStatus,
    pricebook: doubled,
    policy: trialPolicy(doubled),
    availableSubcredits: 3583999,
  };
  const view = await render(<ProTrialSection initialStatus={status.data} />);
  try {
    expect(document.body.textContent).toContain(
      "Text reserves at most 3.584 credits",
    );
    expect(document.body.textContent).toContain(
      "writing suggestion reserves at most 2.240 credits",
    );
    expect(document.body.textContent).toContain(
      "Maximum reservation: 3.584 credits",
    );
    expect(button("Generate with private Pro")?.disabled).toBe(true);
    status.data = { ...status.data, availableSubcredits: 3584000 };
    await view.rerender(<ProTrialSection initialStatus={status.data} />);
    expect(button("Generate with private Pro")?.disabled).toBe(false);
    status.data = {
      ...initialStatus,
      pricebook: {
        ...PRICEBOOK,
        inputNanoUsd: 375,
        cachedInputNanoUsd: 37,
        outputNanoUsd: 2250,
      },
      availableSubcredits: 896000,
    };
    await view.rerender(<ProTrialSection initialStatus={status.data} />);
    expect(document.body.textContent).toContain(
      "Maximum reservation: 0.896 credits",
    );
    expect(button("Generate with private Pro")?.disabled).toBe(false);
  } finally {
    await view.unmount();
  }
});

test("an unknown entitlement period cannot authorize a text reservation using the status fallback pricebook", async () => {
  capability = {
    data: { available: true, reason: "Fixture" },
    error: null,
    isPending: false,
  };
  status.data = { ...initialStatus, entitlementPeriodId: null };
  const view = await render(<ProTrialSection initialStatus={status.data} />);
  try {
    expect(document.body.textContent).toContain(
      "Maximum reservation: unavailable",
    );
    expect(button("Generate with private Pro")?.disabled).toBe(true);
  } finally {
    await view.unmount();
  }
});
