import { act } from "react";
import { afterAll, expect, mock, test } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { installDom, render } from "~/test/dom";
installDom();
const originalFormData = globalThis.FormData;
globalThis.FormData = window.FormData;
afterAll(() => {
  globalThis.FormData = originalFormData;
});
const client = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});
const invalidate = async () => {};
let revokeFails = true;
function action(
  mutationFn: (input: unknown) => Promise<void>,
  options: { onSuccess?: () => Promise<void> },
) {
  return useMutation({ mutationFn, onSuccess: options.onSuccess });
}
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: { status: { invalidate }, ownerAudit: { invalidate } },
    }),
    pro: {
      ownerAudit: {
        useQuery: () => ({ data: [], isPending: false, isError: false }),
      },
      grantEligibility: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) =>
          action(async () => {}, options),
      },
      revoke: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) =>
          action(async () => {
            if (revokeFails) throw Error("refused");
          }, options),
      },
      grantTrial: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) =>
          action(async () => {}, options),
      },
    },
  },
}));
const { ProOwnerTools } = await import("./pro-trial");
async function submit(action: string) {
  const form = document.querySelector("form");
  if (!form) throw Error("Owner form missing");
  const account = form.querySelector<HTMLInputElement>(
    'input[name="accountId"]',
  );
  const reason = form.querySelector<HTMLInputElement>('input[name="reason"]');
  const selection = form.querySelector<HTMLSelectElement>(
    'select[name="action"]',
  );
  if (!account || !reason || !selection) throw Error("Owner fields missing");
  account.value = "tester";
  reason.value = "Approved bounded trial";
  selection.value = action;
  await act(async () => {
    form.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
test("the real owner mutation observers show only the latest submitted action outcome, with audit kept separate", async () => {
  const view = await render(
    <QueryClientProvider client={client}>
      <ProOwnerTools />
    </QueryClientProvider>,
  );
  try {
    await submit("grant");
    expect(document.body.textContent).toContain("Audited change saved.");
    await submit("revoke");
    expect(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.status),
    ).toEqual(["success", "error"]);
    expect(document.body.textContent).toContain("Change rejected.");
    expect(document.body.textContent).not.toContain("Audited change saved.");
    revokeFails = false;
    await submit("revoke");
    expect(document.body.textContent).toContain("Audited change saved.");
    expect(document.body.textContent).not.toContain("Change rejected.");
    expect(document.body.textContent).toContain("No private grants yet.");
  } finally {
    await view.unmount();
    client.clear();
  }
});
