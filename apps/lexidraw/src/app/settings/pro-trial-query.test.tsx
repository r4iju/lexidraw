import { expect, mock, test } from "bun:test";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RouterOutputs } from "~/trpc/shared";
import { PRICEBOOK, trialPolicy } from "~/server/pro/contracts";
import { renderToStaticMarkup } from "react-dom/server";
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
