"use client";
import { ProBillingSection } from "./pro-billing";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { ProLedger } from "~/server/pro/ledger";
import { api } from "~/trpc/react";
export type ProStatus = Awaited<ReturnType<ProLedger["status"]>>;
export function credits(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 6,
  });
}
export function ProUsageDetails({
  balance,
}: {
  balance: Pick<
    ProStatus,
    | "availableSubcredits"
    | "reservedSubcredits"
    | "renewalAt"
    | "history"
    | "policy"
    | "previousPeriodReservedSubcredits"
  >;
}) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Available credits</dt>
        <dd>{credits(balance.availableSubcredits)}</dd>
        <dt>Reserved credits</dt>
        <dd>{credits(balance.reservedSubcredits)}</dd>
        {balance.previousPeriodReservedSubcredits > 0 && (
          <>
            <dt>Reserved from earlier periods</dt>
            <dd>{credits(balance.previousPeriodReservedSubcredits)}</dd>
          </>
        )}
        <dt>Renewal</dt>
        <dd>
          {balance.renewalAt
            ? new Date(balance.renewalAt).toISOString().slice(0, 10)
            : "No active allowance"}
        </dd>
      </dl>
      <p className="text-sm text-muted-foreground">
        {balance.policy.disclosure}
      </p>
      <h3 className="font-medium">Feature usage</h3>
      {balance.history.length === 0 ? (
        <p className="text-sm">No Pro operations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {balance.history.map((op) => (
            <li key={op.id}>
              {op.feature}: {op.state}, {credits(op.charged)} credits charged
              {["reserved", "running", "unknown"].includes(op.state) &&
                ` (${credits(op.quote)} reserved)`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function ProTrialSection({
  initialStatus,
}: {
  initialStatus: ProStatus;
}) {
  const status = api.pro.status.useQuery(undefined, {
    initialData: initialStatus,
    refetchInterval: 2000,
  });
  const utils = api.useUtils();
  const generate = api.pro.text.useMutation({
    onSuccess: () => utils.pro.status.invalidate(),
  });
  const operation = api.pro.operation.useQuery(
    { id: generate.data?.id ?? "" },
    {
      enabled: !!generate.data?.id,
      refetchInterval: (q) =>
        q.state.data && ["reserved", "running"].includes(q.state.data.state)
          ? 1000
          : false,
    },
  );
  const cancel = api.pro.cancel.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.pro.status.invalidate(),
        utils.pro.operation.invalidate(),
      ]);
    },
  });
  const current = operation.data ?? generate.data;
  const working =
    generate.isPending ||
    (!!current && ["reserved", "running"].includes(current.state));
  return (
    <section className="flex flex-col gap-4" aria-labelledby="pro-trial-title">
      <h3 id="pro-trial-title" className="font-semibold">
        Pro, coming soon
      </h3>
      <p className="text-sm">
        Public purchases are unavailable. Private access enables this text trial
        only. Other cloud AI features are not enabled by this trial.
      </p>
      {status.isError ? (
        <p role="alert">
          Could not refresh the allowance.{" "}
          <Button
            variant="outline"
            onClick={() => void utils.pro.status.invalidate()}
          >
            Retry
          </Button>
        </p>
      ) : (
        <ProUsageDetails balance={status.data} />
      )}
      <ProBillingSection status={status.data} />
      {status.data.eligible && (
        <p className="text-sm">
          {status.data.entitled
            ? "Private trial allowance active, shared with iOS."
            : "Private eligibility is approved, but no active allowance is granted."}
        </p>
      )}
      {status.data.entitled && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = new FormData(e.currentTarget).get("text");
            if (typeof text === "string")
              generate.mutate({ idempotencyKey: crypto.randomUUID(), text });
          }}
        >
          <Label htmlFor="pro-text">Text to continue</Label>
          <Input id="pro-text" name="text" required maxLength={1500} />
          <p className="text-sm">
            Maximum reservation: 1.792 credits. Final usage may be lower. Cancel
            stops new paid steps; completed work is charged and uncertain
            outcomes stay reserved.
          </p>
          <Button
            disabled={working || status.data.availableSubcredits < 1_792_000}
          >
            Generate with private Pro
          </Button>
          {working && current && (
            <Button
              type="button"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: current.id })}
            >
              Cancel operation
            </Button>
          )}
        </form>
      )}
      {generate.isError && (
        <p role="alert">
          Could not start the operation.{" "}
          {generate.variables && (
            <Button
              variant="outline"
              onClick={() => {
                if (generate.variables) generate.mutate(generate.variables);
              }}
            >
              Retry the same operation
            </Button>
          )}
        </p>
      )}
      {operation.isError && (
        <p role="alert">
          Could not refresh the result. The server keeps its accounting.{" "}
          <Button
            variant="outline"
            onClick={() => void utils.pro.operation.invalidate()}
          >
            Refresh result
          </Button>
        </p>
      )}
      {cancel.isError && (
        <p role="alert">Could not request cancellation. Try again.</p>
      )}
      {working && (
        <p role="status">
          Private Pro is working. You may leave this screen and check usage
          later.
        </p>
      )}
      {current?.state === "unknown" && (
        <p role="status">
          Provider outcome needs owner reconciliation. Credits remain reserved;
          this request will not be repeated automatically.
        </p>
      )}
      {current?.state === "refunded" && (
        <p role="status">Technical failure. Reserved credits were returned.</p>
      )}
      {current?.state === "cancelled" && (
        <p role="status">
          Cancelled before confirmed completion. Reserved credits were returned.
        </p>
      )}
      {current?.state === "settled" && (
        <p role="status" className="whitespace-pre-wrap">
          {current.result}
        </p>
      )}
      {status.data.owner && <ProOwnerTools />}
    </section>
  );
}

export function ProOwnerTools() {
  const utils = api.useUtils();
  const audit = api.pro.ownerAudit.useQuery();
  const refresh = async () => {
    await Promise.all([
      utils.pro.status.invalidate(),
      utils.pro.ownerAudit.invalidate(),
    ]);
  };
  const grant = api.pro.grantEligibility.useMutation({ onSuccess: refresh });
  const revoke = api.pro.revoke.useMutation({ onSuccess: refresh });
  const trial = api.pro.grantTrial.useMutation({ onSuccess: refresh });
  return (
    <details className="rounded-md border p-3">
      <summary className="font-medium">Owner private-trial controls</summary>
      <p className="my-3 text-sm">
        Use the trusted account ID, never an email or shared tester login.
        Eligibility and allowance are separate grants. Every change records your
        identity and reason.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          const accountId = values.get("accountId");
          const reason = values.get("reason");
          const action = values.get("action");
          if (typeof accountId !== "string" || typeof reason !== "string")
            return;
          const input = { accountId, reason };
          if (action === "grant") grant.mutate(input);
          else if (action === "revoke") revoke.mutate(input);
          else {
            const start = values.get("start");
            const end = values.get("end");
            if (typeof start === "string" && typeof end === "string")
              trial.mutate({
                ...input,
                eventId: crypto.randomUUID(),
                startsAt: Date.parse(start),
                endsAt: Date.parse(end),
                subcredits: 1_000_000_000,
              });
          }
        }}
      >
        <Label htmlFor="trial-account">Account ID</Label>
        <Input id="trial-account" name="accountId" required maxLength={100} />
        <Label htmlFor="trial-reason">Authorization reason</Label>
        <Input id="trial-reason" name="reason" required maxLength={500} />
        <Label htmlFor="trial-action">Action</Label>
        <select
          id="trial-action"
          name="action"
          className="rounded-md border bg-background p-2"
        >
          <option value="grant">Grant private eligibility</option>
          <option value="revoke">Revoke private eligibility</option>
          <option value="trial">Grant one bounded 1,000-credit period</option>
        </select>
        <Label htmlFor="trial-start">Period start (for allowance grant)</Label>
        <Input id="trial-start" type="date" name="start" />
        <Label htmlFor="trial-end">Period end (maximum 32 days)</Label>
        <Input id="trial-end" type="date" name="end" />
        <Button
          disabled={grant.isPending || revoke.isPending || trial.isPending}
        >
          Apply audited change
        </Button>
      </form>
      {(grant.isError || revoke.isError || trial.isError) && (
        <p role="alert">
          Change rejected. Check eligibility, dates, existing period and
          authorization.
        </p>
      )}
      {(grant.isSuccess || revoke.isSuccess || trial.isSuccess) && (
        <p role="status">Audited change saved.</p>
      )}
      {audit.isPending ? (
        <p>Loading audit…</p>
      ) : audit.isError ? (
        <p role="alert">Audit unavailable.</p>
      ) : audit.data.length === 0 ? (
        <p>No private grants yet.</p>
      ) : (
        <ul className="mt-3 text-sm">
          {audit.data.map((item) => (
            <li key={String(item.id)}>
              {String(item.action)}: {String(item.account_id)},{" "}
              {String(item.reason)}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
