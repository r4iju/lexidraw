"use client";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import type { ProStatus } from "./pro-trial";
export function ProBillingDetails({
  billing,
  eligible,
}: {
  billing: ProStatus["billing"];
  eligible: ProStatus["eligible"];
}) {
  if (!eligible)
    return <p>Pro Coming soon. Public purchases are unavailable.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <h4 className="font-semibold">Sandbox/test payment</h4>
      <p>
        $12/month · 1,000 credits per period. Test payment only, no customer
        charge. No annual plan, top-ups, overage or rollover.
      </p>
      {!billing.available && (
        <p>
          Sandbox billing unavailable. External test setup is missing or
          unsupported.
        </p>
      )}
      <p>
        Status:{" "}
        {billing.state === "none"
          ? "No sandbox subscription"
          : billing.state.replaceAll("_", " ")}
      </p>
      {billing.expiresAt && (
        <p>
          {billing.cancelAtEnd && billing.state === "active"
            ? "Ends at period expiry"
            : "Period expiry"}
          : {new Date(billing.expiresAt).toISOString().slice(0, 10)}
        </p>
      )}
      <p>
        Billing does not enable an unavailable Pro capability. Your account
        allowance is shared with iOS. Saved playback, local AI and your own key
        remain available after expiry.
      </p>
    </div>
  );
}
export function ProBillingSection({ status }: { status: ProStatus }) {
  const utils = api.useUtils();
  const checkout = api.pro.sandboxCheckout.useMutation({
    onSuccess: async (data) => {
      await utils.pro.status.invalidate();
      window.location.assign(data.url);
    },
  });
  const management = api.pro.sandboxManagement.useMutation({
    onSuccess: async (data) => {
      await utils.pro.status.invalidate();
      window.location.assign(data.url);
    },
  });
  const pending = checkout.isPending || management.isPending;
  return (
    <section className="flex flex-col gap-3" aria-label="Sandbox billing">
      <ProBillingDetails billing={status.billing} eligible={status.eligible} />
      {status.billing.available && (
        <div className="flex gap-2">
          {!status.billing.customerBound ||
          !["active", "payment_failed"].includes(status.billing.state) ? (
            <Button disabled={pending} onClick={() => checkout.mutate({})}>
              Buy sandbox subscription
            </Button>
          ) : null}
          {status.billing.customerBound && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => management.mutate({})}
            >
              Manage sandbox subscription
            </Button>
          )}
        </div>
      )}
      {(checkout.isError || management.isError) && (
        <p role="alert">
          Sandbox billing could not open. Try again after refreshing your
          account status.
        </p>
      )}
    </section>
  );
}
