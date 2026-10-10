import { z } from "zod";
import type { Client, InArgs, Transaction } from "@libsql/client";
import {
  PRICEBOOK,
  TRIAL_POLICY,
  TEXT_QUOTE,
  Operation,
  referenceCharge,
  type Usage,
  MAX_ATTEMPT_NANO_USD,
  Completion,
} from "./contracts";

export class ProError extends Error {}
export class ProLedger {
  constructor(
    readonly client: Client,
    readonly config: { ownerAccountIds: readonly string[]; now: () => number },
  ) {}
  owner(actor: string) {
    if (!this.config.ownerAccountIds.includes(actor))
      throw new ProError("Owner authorization required");
  }
  private async write<T>(body: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const tx = await this.beginWrite();
      try {
        const result = await body(tx);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        const parsed = z.object({ code: z.string() }).safeParse(error);
        // A confirmed SQLite lock failure rolls back this DB-only unit. Network/ambiguous commit failures are never replayed here.
        if (
          !parsed.success ||
          parsed.data.code !== "SQLITE_BUSY" ||
          attempt >= 7
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10 * 2 ** attempt, 100)),
        );
      } finally {
        tx.close();
      }
    }
  }
  private async beginWrite(): Promise<Transaction> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.transaction("write");
      } catch (error) {
        const parsed = z.object({ code: z.string() }).safeParse(error);
        if (
          !parsed.success ||
          parsed.data.code !== "SQLITE_BUSY" ||
          attempt >= 7
        )
          throw error;
        // Only retry acquiring the write lock, never an ambiguous commit or provider request.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10 * 2 ** attempt, 100)),
        );
      }
    }
  }
  async query(sql: string, args: InArgs = []) {
    return (await this.client.execute({ sql, args })).rows;
  }
  async grantEligibility(actor: string, accountId: string, reason: string) {
    this.owner(actor);
    this.reason(reason);
    await this.write(async (tx) => {
      await tx.execute({
        sql: "INSERT INTO pro_eligibility VALUES (?,1) ON CONFLICT(account_id) DO UPDATE SET active=1",
        args: [accountId],
      });
      await this.auditWrite(
        tx,
        actor,
        accountId,
        "eligibility_granted",
        reason,
      );
    });
  }
  reason(reason: string) {
    if (!reason.trim() || reason.length > 500)
      throw new ProError("Explicit reason required");
  }
  async auditWrite(
    tx: Transaction,
    actor: string,
    account: string,
    action: string,
    reason: string,
  ) {
    await tx.execute({
      sql: "INSERT INTO pro_audit(actor_id,account_id,action,reason,created_at) VALUES (?,?,?,?,?)",
      args: [actor, account, action, reason, this.config.now()],
    });
  }
  async grantPeriod(
    actor: string,
    input: {
      accountId: string;
      eventId: string;
      startsAt: number;
      endsAt: number;
      subcredits: number;
      reason: string;
      environment: "test" | "sandbox";
    },
  ) {
    this.owner(actor);
    this.reason(input.reason);
    if (input.environment !== "test")
      throw new ProError("Verified sandbox billing adapter required");
    return this.createPeriod(actor, { ...input, source: "owner_test" });
  }
  /** Called only by a server-owned verifier adapter; never accept verifier functions or events from an API request. */
  async consumePurchase(
    payload: unknown,
    verify: (payload: unknown) => Promise<unknown>,
  ) {
    const parsed = z
      .strictObject({
        accountId: z.string().min(1),
        eventId: z.string().min(1),
        startsAt: z.number().int(),
        endsAt: z.number().int(),
        environment: z.literal("sandbox"),
        source: z.enum(["stripe", "apple"]),
      })
      .safeParse(await verify(payload));
    if (!parsed.success) throw new ProError("Sandbox verification required");
    const event = parsed.data;
    return this.createPeriod(
      `billing:${event.source}`,
      {
        ...event,
        eventId: `${event.source}:${event.eventId}`,
        subcredits: 1_000_000_000,
        reason: "Verified sandbox subscription period",
      },
      true,
    );
  }
  private async createPeriod(
    actor: string,
    input: {
      accountId: string;
      eventId: string;
      startsAt: number;
      endsAt: number;
      subcredits: number;
      reason: string;
      environment: "test" | "sandbox";
      source: string;
    },
    duplicatePeriod = false,
  ) {
    return this.write(async (tx) => {
      const eligible = await tx.execute({
        sql: "SELECT active FROM pro_eligibility WHERE account_id=?",
        args: [input.accountId],
      });
      if (eligible.rows[0]?.active !== 1)
        throw new ProError("Private eligibility required");
      const existing = await tx.execute({
        sql: "SELECT * FROM pro_billing_events WHERE event_id=?",
        args: [input.eventId],
      });
      if (existing.rows[0]) {
        const prior = existing.rows[0];
        if (
          prior.account_id !== input.accountId ||
          prior.starts_at !== input.startsAt ||
          prior.ends_at !== input.endsAt ||
          prior.subcredits !== input.subcredits ||
          prior.environment !== input.environment
        )
          throw new ProError("Billing event conflicts with prior grant");
        return String(prior.period_id);
      }
      const overlap = await tx.execute({
        sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<? AND ends_at>?",
        args: [input.accountId, input.endsAt, input.startsAt],
      });
      if (overlap.rows[0]) {
        const period = overlap.rows[0];
        if (
          !duplicatePeriod ||
          period.starts_at !== input.startsAt ||
          period.ends_at !== input.endsAt ||
          period.environment !== input.environment ||
          period.granted !== input.subcredits
        )
          throw new ProError("One allowance per period; no top-ups");
        await this.billingEvent(tx, input, String(period.id));
        return String(period.id);
      }
      if (
        !Number.isSafeInteger(input.subcredits) ||
        input.subcredits < 1 ||
        input.subcredits > 1_000_000_000 ||
        !Number.isSafeInteger(input.startsAt) ||
        !Number.isSafeInteger(input.endsAt) ||
        input.endsAt <= input.startsAt ||
        input.endsAt - input.startsAt > 32 * 86400000
      )
        throw new ProError("Invalid bounded period");
      const id = crypto.randomUUID();
      await tx.execute({
        sql: "INSERT INTO pro_periods(id,account_id,event_id,starts_at,ends_at,environment,pricebook,granted,available) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [
          id,
          input.accountId,
          input.eventId,
          input.startsAt,
          input.endsAt,
          input.environment,
          JSON.stringify(PRICEBOOK),
          input.subcredits,
          input.subcredits,
        ],
      });
      await tx.execute({
        sql: "INSERT INTO pro_ledger(account_id,period_id,kind,subcredits,created_at) VALUES (?,?,'grant',?,?)",
        args: [input.accountId, id, input.subcredits, this.config.now()],
      });
      await this.billingEvent(tx, input, id);
      await this.auditWrite(
        tx,
        actor,
        input.accountId,
        "period_granted",
        input.reason,
      );
      return id;
    });
  }
  private async billingEvent(
    tx: Transaction,
    event: {
      accountId: string;
      eventId: string;
      source: string;
      environment: string;
      startsAt: number;
      endsAt: number;
      subcredits: number;
    },
    period: string,
  ) {
    await tx.execute({
      sql: "INSERT INTO pro_billing_events(event_id,source,environment,account_id,period_id,starts_at,ends_at,subcredits,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      args: [
        event.eventId,
        event.source,
        event.environment,
        event.accountId,
        period,
        event.startsAt,
        event.endsAt,
        event.subcredits,
        this.config.now(),
      ],
    });
  }
  async status(account: string) {
    const [eligible, periods, history, costs, oldReservations] =
      await Promise.all([
        this.query("SELECT active FROM pro_eligibility WHERE account_id=?", [
          account,
        ]),
        this.query(
          "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1",
          [account, this.config.now(), this.config.now()],
        ),
        this.query(
          "SELECT id,feature,state,quote,charged,created_at FROM pro_operations WHERE account_id=? ORDER BY CASE WHEN state IN ('reserved','running','unknown') THEN 0 ELSE 1 END,created_at DESC,id LIMIT 50",
          [account],
        ),
        this.query(
          "SELECT SUM(a.cost_nano_usd) AS known, SUM(CASE WHEN a.cost_nano_usd IS NULL THEN a.exposure_nano_usd ELSE 0 END) AS unknown FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=?",
          [account],
        ),
        this.query(
          "SELECT SUM(reserved) AS reserved FROM pro_periods WHERE account_id=? AND ends_at<=?",
          [account, this.config.now()],
        ),
      ]);
    const period = periods[0];
    return {
      owner: this.config.ownerAccountIds.includes(account),
      publicState: "coming_soon" as const,
      liveCheckout: false as const,
      paymentEnvironment: "disabled" as const,
      eligible: eligible[0]?.active === 1,
      entitled: eligible[0]?.active === 1 && !!period,
      availableSubcredits: Number(period?.available ?? 0),
      reservedSubcredits: Number(period?.reserved ?? 0),
      previousPeriodReservedSubcredits: Number(
        oldReservations[0]?.reserved ?? 0,
      ),
      renewalAt: period ? Number(period.ends_at) : null,
      history: z
        .array(
          Operation.pick({
            id: true,
            feature: true,
            state: true,
            quote: true,
            charged: true,
            created_at: true,
          }),
        )
        .parse(history),
      providerCosts: {
        knownNanoUsd: Number(costs[0]?.known ?? 0),
        unknownExposureNanoUsd: Number(costs[0]?.unknown ?? 0),
      },
      policy: TRIAL_POLICY,
      pricebook: PRICEBOOK,
    };
  }
  async audit(actor: string) {
    this.owner(actor);
    return this.query("SELECT * FROM pro_audit ORDER BY id");
  }
  async reserve(account: string, key: string, inputHash: string) {
    return this.write(async (tx) => {
      const access = await tx.execute({
        sql: "SELECT active FROM pro_eligibility WHERE account_id=?",
        args: [account],
      });
      if (access.rows[0]?.active !== 1)
        throw new ProError("Private entitlement required");
      const existing = await tx.execute({
        sql: "SELECT * FROM pro_operations WHERE account_id=? AND idempotency_key=?",
        args: [account, key],
      });
      if (existing.rows[0]) {
        const operation = Operation.parse(existing.rows[0]);
        if (operation.input_hash !== inputHash)
          throw new ProError("Idempotency key conflicts with prior input");
        return operation;
      }
      const period = (
        await tx.execute({
          sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>?",
          args: [account, this.config.now(), this.config.now()],
        })
      ).rows[0];
      if (!period) throw new ProError("Private entitlement required");
      const counts = (
        await tx.execute({
          sql: "SELECT SUM(CASE WHEN state IN ('reserved','running','unknown') THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS recent FROM pro_operations WHERE account_id=?",
          args: [this.config.now() - 60000, account],
        })
      ).rows[0];
      if (
        Number(counts?.active ?? 0) >= PRICEBOOK.maxConcurrent ||
        Number(counts?.recent ?? 0) >= PRICEBOOK.maxRequestsPerMinute
      )
        throw new ProError("Request limit reached");
      const reserved = await tx.execute({
        sql: "UPDATE pro_periods SET available=available-?,reserved=reserved+? WHERE id=? AND available>=?",
        args: [TEXT_QUOTE, TEXT_QUOTE, period.id ?? "", TEXT_QUOTE],
      });
      if (!reserved.rowsAffected) throw new ProError("Insufficient credits");
      const id = crypto.randomUUID();
      await tx.execute({
        sql: "INSERT INTO pro_operations(id,account_id,period_id,idempotency_key,input_hash,feature,state,quote,pricebook,policy,created_at) VALUES (?,?,?,?,?,'text','reserved',?,?,?,?)",
        args: [
          id,
          account,
          period.id ?? "",
          key,
          inputHash,
          TEXT_QUOTE,
          String(period.pricebook),
          TRIAL_POLICY.version,
          this.config.now(),
        ],
      });
      await tx.execute({
        sql: "INSERT INTO pro_reservations(operation_id,period_id,amount) VALUES (?,?,?)",
        args: [id, period.id ?? "", TEXT_QUOTE],
      });
      await this.entry(
        tx,
        account,
        String(period.id),
        id,
        "reservation",
        TEXT_QUOTE,
      );
      return Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
    });
  }
  async operation(account: string, id: string) {
    const row = (
      await this.query(
        "SELECT * FROM pro_operations WHERE account_id=? AND id=?",
        [account, id],
      )
    )[0];
    if (!row) throw new ProError("Operation not found");
    return Operation.parse(row);
  }
  async entry(
    tx: Transaction,
    account: string,
    period: string,
    operation: string,
    kind: string,
    amount: number,
  ) {
    await tx.execute({
      sql: "INSERT INTO pro_ledger(account_id,period_id,operation_id,kind,subcredits,created_at) VALUES (?,?,?,?,?,?)",
      args: [account, period, operation, kind, amount, this.config.now()],
    });
  }
  async settle(
    id: string,
    outcome:
      | { kind: "completed"; text: string; usage: Usage }
      | { kind: "technical_failure" | "cancelled" },
    reconciled = false,
  ) {
    return this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
      if (["settled", "refunded", "cancelled"].includes(op.state)) return op;
      const pending = (
        await tx.execute({
          sql: "SELECT id FROM pro_attempts WHERE operation_id=? AND state IN ('started','unknown')",
          args: [id],
        })
      ).rows;
      if (pending.length && !reconciled) return op;
      const completed = (
        await tx.execute({
          sql: "SELECT result FROM pro_attempts WHERE operation_id=? AND state='completed' ORDER BY number DESC LIMIT 1",
          args: [id],
        })
      ).rows[0];
      // Durable completion outranks a losing executor's failure/cancellation verdict.
      // Read it under the settlement write lock so no refund can race its commit.
      const completion = completed
        ? Completion.parse(JSON.parse(String(completed.result)))
        : undefined;
      const resolved = completion
        ? {
            kind: "completed" as const,
            text: completion.text,
            usage: completion.usage,
          }
        : outcome;
      const charge =
        resolved.kind === "completed"
          ? referenceCharge(resolved.usage, JSON.parse(op.pricebook))
          : 0;
      if (charge > op.quote)
        throw new ProError("Settlement exceeds accepted quote");
      const state =
        resolved.kind === "completed"
          ? "settled"
          : resolved.kind === "technical_failure"
            ? "refunded"
            : "cancelled";
      await tx.execute({
        sql: "UPDATE pro_periods SET available=available+?-?,reserved=reserved-? WHERE id=?",
        args: [op.quote, charge, op.quote, op.period_id],
      });
      await tx.execute({
        sql: "UPDATE pro_reservations SET active=0 WHERE operation_id=? AND active=1",
        args: [id],
      });
      await tx.execute({
        sql: "UPDATE pro_operations SET state=?,charged=?,result=? WHERE id=?",
        args: [
          state,
          charge,
          resolved.kind === "completed" ? resolved.text : null,
          id,
        ],
      });
      await this.entry(
        tx,
        op.account_id,
        op.period_id,
        id,
        "release",
        op.quote,
      );
      await this.entry(
        tx,
        op.account_id,
        op.period_id,
        id,
        charge ? "debit" : state === "refunded" ? "refund" : "cancellation",
        charge,
      );
      return Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
    });
  }
  async entries(account: string) {
    return this.query(
      "SELECT * FROM pro_ledger WHERE account_id=? ORDER BY id",
      [account],
    );
  }

  async revoke(actor: string, account: string, reason: string) {
    this.owner(actor);
    this.reason(reason);
    await this.write(async (tx) => {
      await tx.execute({
        sql: "UPDATE pro_eligibility SET active=0 WHERE account_id=?",
        args: [account],
      });
      await tx.execute({
        sql: "UPDATE pro_operations SET cancel_requested=1 WHERE account_id=? AND state IN ('reserved','running','unknown')",
        args: [account],
      });
      await this.auditWrite(tx, actor, account, "eligibility_revoked", reason);
    });
  }
  async claim(id: string) {
    return this.write(
      async (tx) =>
        (
          await tx.execute({
            sql: "UPDATE pro_operations SET state='running' WHERE id=? AND (state='reserved' OR (state='running' AND NOT EXISTS (SELECT 1 FROM pro_attempts WHERE operation_id=pro_operations.id))) AND cancel_requested=0",
            args: [id],
          })
        ).rowsAffected === 1,
    );
  }
  async startAttempt(id: string) {
    return this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
      const access = (
        await tx.execute({
          sql: "SELECT active FROM pro_eligibility WHERE account_id=?",
          args: [op.account_id],
        })
      ).rows[0];
      if (
        op.state !== "running" ||
        op.cancel_requested ||
        access?.active !== 1 ||
        this.config.now() - op.created_at >= PRICEBOOK.maxElapsedMs
      )
        throw new ProError("Paid steps stopped");
      const attempts = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
          args: [id],
        })
      ).rows;
      if (
        attempts.length >= PRICEBOOK.maxAttempts ||
        attempts.some((a) => a.state !== "failed")
      )
        throw new ProError("Attempt limit or unresolved outcome");
      const accountSpend = (
        await tx.execute({
          sql: "SELECT SUM(COALESCE(a.cost_nano_usd,a.exposure_nano_usd)) AS spend FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=? AND o.period_id=?",
          args: [op.account_id, op.period_id],
        })
      ).rows[0];
      const failureSpend = (
        await tx.execute({
          sql: "SELECT SUM(COALESCE(a.cost_nano_usd,a.exposure_nano_usd)) AS spend FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=? AND o.period_id=? AND (a.state IN ('failed','unknown','started') OR o.state IN ('refunded','cancelled'))",
          args: [op.account_id, op.period_id],
        })
      ).rows[0];
      const globalSpend = (
        await tx.execute({
          sql: "SELECT SUM(COALESCE(cost_nano_usd,exposure_nano_usd)) AS spend FROM pro_attempts WHERE created_at>?",
          args: [this.config.now() - 86400000],
        })
      ).rows[0];
      const failures = (
        await tx.execute({
          sql: "SELECT COUNT(*) AS failures FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=? AND a.state IN ('failed','unknown') AND a.created_at>?",
          args: [op.account_id, this.config.now() - 60000],
        })
      ).rows[0];
      if (
        Number(failureSpend?.spend ?? 0) + MAX_ATTEMPT_NANO_USD >
          PRICEBOOK.accountFailureSpendNanoUsd ||
        Number(accountSpend?.spend ?? 0) + MAX_ATTEMPT_NANO_USD >
          PRICEBOOK.accountSpendNanoUsd ||
        Number(globalSpend?.spend ?? 0) + MAX_ATTEMPT_NANO_USD >
          PRICEBOOK.globalDailySpendNanoUsd ||
        Number(failures?.failures ?? 0) >= 5
      )
        throw new ProError("Provider spend circuit open");
      const attempt = crypto.randomUUID();
      await tx.execute({
        sql: "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,created_at) VALUES (?,?,?,'started',?,?)",
        args: [
          attempt,
          id,
          attempts.length + 1,
          MAX_ATTEMPT_NANO_USD,
          this.config.now(),
        ],
      });
      return attempt;
    });
  }
  async finishAttempt(
    id: string,
    outcome:
      | { kind: "completed"; completion: Completion }
      | { kind: "failed" | "unknown"; actualCostNanoUsd?: number },
  ) {
    await this.write(async (tx) => {
      const attempt = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE id=?",
          args: [id],
        })
      ).rows[0];
      if (attempt?.state !== "started") return;
      const completed =
        outcome.kind === "completed"
          ? Completion.parse(outcome.completion)
          : undefined;
      const cost =
        completed?.actualCostNanoUsd ??
        (outcome.kind !== "completed" ? outcome.actualCostNanoUsd : undefined);
      if (
        cost !== undefined &&
        (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_ATTEMPT_NANO_USD)
      )
        throw new ProError("Invalid attempt cost");
      await tx.execute({
        sql: "UPDATE pro_attempts SET state=?,cost_nano_usd=?,usage=?,result=? WHERE id=?",
        args: [
          outcome.kind,
          cost ?? null,
          completed ? JSON.stringify(completed.usage) : null,
          completed ? JSON.stringify(completed) : null,
          id,
        ],
      });
      if (outcome.kind === "unknown")
        await tx.execute({
          sql: "UPDATE pro_operations SET state='unknown' WHERE id=?",
          args: [attempt.operation_id ?? ""],
        });
    });
  }
  async attempts(account: string, id: string) {
    await this.operation(account, id);
    return this.query(
      "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
      [id],
    );
  }
  async cancel(account: string, id: string) {
    const op = await this.operation(account, id);
    await this.write(async (tx) => {
      await tx.execute({
        sql: "UPDATE pro_operations SET cancel_requested=1 WHERE account_id=? AND id=?",
        args: [account, id],
      });
    });
    if (op.state === "reserved") {
      // Claim and cancellation race: settle only while no provider attempt exists.
      await this.write(async (tx) => {
        const attempts = await tx.execute({
          sql: "SELECT id FROM pro_attempts WHERE operation_id=?",
          args: [id],
        });
        if (!attempts.rows.length)
          await tx.execute({
            sql: "UPDATE pro_operations SET state='reserved' WHERE id=? AND state='running'",
            args: [id],
          });
      });
      const current = await this.operation(account, id);
      if (current.state === "reserved")
        await this.settle(id, { kind: "cancelled" });
    }
    return this.operation(account, id);
  }
  async reconcile(
    actor: string,
    id: string,
    outcome: Parameters<ProLedger["settle"]>[1],
    evidence: string,
  ) {
    this.owner(actor);
    this.reason(evidence);
    const op = Operation.parse(
      (await this.query("SELECT * FROM pro_operations WHERE id=?", [id]))[0],
    );
    await this.write(async (tx) => {
      await this.auditWrite(
        tx,
        actor,
        op.account_id,
        "operation_reconciled",
        `${id}: ${outcome.kind}; ${evidence}`,
      );
      // Unknown invoice costs remain explicit; reconciliation does not invent free provider usage.
      await tx.execute({
        sql: "UPDATE pro_attempts SET state='unknown' WHERE operation_id=? AND state='started'",
        args: [id],
      });
    });
    return this.settle(id, outcome, true);
  }

  async reconcileAttemptCost(
    actor: string,
    attemptId: string,
    costNanoUsd: number,
    evidence: string,
  ) {
    this.owner(actor);
    this.reason(evidence);
    if (!Number.isSafeInteger(costNanoUsd) || costNanoUsd < 0)
      throw new ProError("Invalid invoice cost");
    await this.write(async (tx) => {
      const attempt = (
        await tx.execute({
          sql: "SELECT a.state,o.account_id FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE a.id=?",
          args: [attemptId],
        })
      ).rows[0];
      if (!attempt || attempt.state === "started")
        throw new ProError(
          "Resolve provider outcome before reconciling invoice cost",
        );
      await tx.execute({
        sql: "UPDATE pro_attempts SET cost_nano_usd=? WHERE id=?",
        args: [costNanoUsd, attemptId],
      });
      await this.auditWrite(
        tx,
        actor,
        String(attempt.account_id),
        "provider_cost_reconciled",
        `${attemptId}: ${costNanoUsd} nano-USD; ${evidence}`,
      );
    });
  }

  async ownerOperation(actor: string, id: string) {
    this.owner(actor);
    const op = Operation.parse(
      (await this.query("SELECT * FROM pro_operations WHERE id=?", [id]))[0],
    );
    return { operation: op, attempts: await this.attempts(op.account_id, id) };
  }
}
