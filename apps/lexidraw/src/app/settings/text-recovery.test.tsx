import { act } from "react";
import { afterAll, expect, mock, test } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import {
  PRICEBOOK,
  trialPolicy,
  type Operation,
  type TextInput,
} from "~/server/pro/contracts";
import type { RouterOutputs } from "~/trpc/shared";
import { button, click, installDom, render } from "~/test/dom";
installDom();
const originalFormData = globalThis.FormData;
globalThis.FormData = window.FormData;
afterAll(() => {
  globalThis.FormData = originalFormData;
});
const initialStatus: RouterOutputs["pro"]["status"] = {
  owner: false,
  publicState: "coming_soon",
  liveCheckout: false,
  paymentEnvironment: "disabled",
  billing: {
    environment: "sandbox",
    available: false,
    canCheckout: false,
    canManageWeb: false,
    monthlyUsd: 12,
    monthlyCredits: 1000,
    state: "none",
    cancelAtEnd: false,
    expiresAt: null,
    customerBound: false,
    source: null,
    appleAvailable: false,
  },
  entitlementPeriodId: "period",
  textMaximumSubcredits: 1792000,
  autocompleteMaximumSubcredits: 1120000,
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
type Input = import("zod").infer<typeof TextInput>;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const submitted: Input[] = [];
const reads: Input[] = [];
let found = false;
let operationAccount = "alice";
function operation(input: Input): Operation {
  return {
    id: "owned-text",
    account_id: operationAccount,
    period_id: "period",
    idempotency_key: input.idempotencyKey,
    input_hash: "fixture-hash",
    feature: "text",
    state: "settled",
    quote: 1792000,
    charged: 31000,
    pricebook: JSON.stringify(PRICEBOOK),
    policy: "Fixture",
    result: "Recovered original output",
    cancel_requested: 0,
    created_at: 1000,
  };
}
const invalidate = async () => {};
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: {
        status: { invalidate },
        operation: { invalidate },
        textRecovery: { invalidate },
      },
    }),
    pro: {
      status: {
        useQuery: () =>
          useQuery({
            queryKey: ["status"],
            queryFn: async () => initialStatus,
            initialData: initialStatus,
            staleTime: Infinity,
          }),
      },
      textCapability: {
        useQuery: () =>
          useQuery({
            queryKey: ["capability"],
            queryFn: async () => ({ available: true, reason: "Fixture" }),
            initialData: { available: true, reason: "Fixture" },
            staleTime: Infinity,
          }),
      },
      text: {
        useMutation: (options: { onSuccess?: () => unknown }) =>
          useMutation({
            mutationFn: async (input: Input): Promise<Operation> => {
              submitted.push(input);
              throw Error("Lost acceptance reply");
            },
            onSuccess: async () => {
              await options.onSuccess?.();
            },
          }),
      },
      textRecovery: {
        useQuery: (input: Input, options: { enabled: boolean }) =>
          useQuery({
            queryKey: ["recovery", input],
            queryFn: async () => {
              reads.push(input);
              if (!found) throw Error("Operation not found yet");
              return operation(input);
            },
            ...options,
            retry: false,
          }),
      },
      operation: {
        useQuery: (_input: unknown, options: { enabled: boolean }) =>
          useQuery({
            queryKey: ["operation"],
            queryFn: async () => operation(submitted[0]!),
            ...options,
          }),
      },
      cancel: {
        useMutation: () =>
          useMutation({ mutationFn: async () => operation(submitted[0]!) }),
      },
      sandboxCheckout: {
        useMutation: () =>
          useMutation({
            mutationFn: async () => {
              throw Error("No billing");
            },
          }),
      },
      sandboxManagement: {
        useMutation: () =>
          useMutation({
            mutationFn: async () => {
              throw Error("No billing");
            },
          }),
      },
    },
  },
}));
const { ProTrialSection } = await import("./pro-trial");
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
test("lost text acceptance retains its original key through NotFound and closed admission, then recovers by owned read without resubmission", async () => {
  const view = await render(
    <QueryClientProvider client={client}>
      <ProTrialSection accountId="alice" initialStatus={initialStatus} />
    </QueryClientProvider>,
  );
  try {
    const field =
      document.querySelector<HTMLInputElement>('input[name="text"]');
    const form = field?.form;
    if (!field || !form) throw Error("Trial text form missing");
    field.value = "Continue me";
    await act(async () => {
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    await flush();
    expect(submitted).toHaveLength(1);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual(submitted[0]);
    await act(async () => {
      client.setQueryData(["status"], {
        ...initialStatus,
        entitled: false,
        entitlementPeriodId: null,
      });
      client.setQueryData(["capability"], {
        available: false,
        reason: "Closed",
      });
    });
    await flush();
    expect(button("Refresh owned text")).toBeDefined();
    expect(button("Generate with private Pro")).toBeUndefined();
    found = true;
    await click(button("Refresh owned text"));
    await flush();
    expect(document.body.textContent).toContain("Recovered original output");
    expect(
      reads.every(
        (input) => JSON.stringify(input) === JSON.stringify(submitted[0]),
      ),
    ).toBe(true);
    expect(submitted).toHaveLength(1);
  } finally {
    await view.unmount();
    client.clear();
  }
});

test("a remounted account-owned trial retains a lost initial acceptance key with admission closed and does not submit again", async () => {
  submitted.length = 0;
  reads.length = 0;
  found = false;
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <ProTrialSection
          accountId="remount-alice"
          initialStatus={initialStatus}
        />
      </QueryClientProvider>,
    );
  let view = await mount();
  try {
    const field =
      document.querySelector<HTMLInputElement>('input[name="text"]');
    if (!field?.form) throw Error("Trial form missing");
    field.value = "Retain this exact request";
    await act(async () => {
      field.form?.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    await flush();
    expect(reads[0]).toEqual(submitted[0]);
    await view.unmount();
    client.clear();
    client.setQueryData(["status"], {
      ...initialStatus,
      entitled: false,
      entitlementPeriodId: null,
    });
    client.setQueryData(["capability"], { available: false, reason: "Closed" });
    found = true;
    const foreign = await render(
      <QueryClientProvider client={client}>
        <ProTrialSection accountId="bob" initialStatus={initialStatus} />
      </QueryClientProvider>,
    );
    await flush();
    expect(reads).toHaveLength(1);
    expect(button("Refresh owned text")).toBeUndefined();
    await foreign.unmount();
    operationAccount = "remount-alice";
    view = await mount();
    await flush();
    await flush();
    expect(reads).toHaveLength(2);
    expect(reads[1]).toEqual(submitted[0]);
    expect(document.body.textContent).toContain("Recovered original output");
    expect(button("Refresh owned text")).toBeDefined();
    expect(button("Generate with private Pro")).toBeUndefined();
    expect(submitted).toHaveLength(1);
  } finally {
    await view.unmount();
    client.clear();
  }
});
