import { SqlInteger, SqlSum, SqlFlag } from "~/server/sql-row";
import {
  SupplierBooks,
  SupplierContract,
  supplierMaximum,
  makeSupplierContract,
  archivedSupplier,
  validateSupplierCompletion,
} from "./supplier-contract";
import { PeriodRates, decodePeriodRates } from "./period-rates";
import {
  AgentBook,
  AgentInput,
  AgentCompletion,
  Report,
  agentCharge,
  AgentAttemptDescriptor,
} from "~/lib/agent/contracts";
import { audioSeconds } from "./narration-audio";
import {
  NARRATION_BOOK,
  NarrationBook,
  NarrationReservation,
  NarrationPlan,
  NarrationPart,
  narrationCharge,
} from "~/lib/narration/contracts";
import { validateImagePixels } from "~/server/entities/image-raster";
import {
  ImageCompletion,
  ImagePricebook,
  imageCharge,
  validateImage,
} from "~/lib/images/contracts";
import { z } from "zod";
import type { Client, InArgs, Transaction } from "@libsql/client";
import {
  PRICEBOOK,
  PRICEBOOK_V1,
  TextBook,
  textMaximum,
  TRIAL_POLICY,
  trialPolicy,
  Operation,
  referenceCharge,
  type Usage,
  Completion,
} from "./contracts";

const SubscriptionRow = z.object({
  source: z.enum(["apple", "stripe"]),
  state: z.enum([
    "active",
    "expired",
    "revoked",
    "payment_failed",
    "cancelled",
  ]),
  starts_at: SqlInteger,
  ends_at: SqlInteger,
  cancel_at_end: SqlFlag,
});
const StatusPeriodRow = z.object({
  id: z.string(),
  pricebook: z.string(),
  blocked: SqlFlag,
  available: SqlInteger,
  reserved: SqlInteger,
  ends_at: SqlInteger,
});
const CostsRow = z.object({ known: SqlSum, absorbed: SqlSum, unknown: SqlSum });
const AttemptRow = z.object({
  id: z.string(),
  operation_id: z.string(),
  number: SqlInteger,
  state: z.enum(["started", "completed", "failed", "unknown"]),
  cost_nano_usd: SqlInteger.nullable(),
  exposure_nano_usd: SqlInteger,
  usage: z.string().nullable(),
  result: z.string().nullable(),
  chunk_hash: z.string().nullable().optional(),
  created_at: SqlInteger,
});
const AuditRow = z.object({
  id: SqlInteger,
  actor_id: z.string(),
  account_id: z.string(),
  action: z.string(),
  reason: z.string(),
  created_at: SqlInteger,
});
const EntryRow = z.object({
  id: SqlInteger,
  account_id: z.string(),
  period_id: z.string(),
  operation_id: z.string().nullable(),
  kind: z.string(),
  subcredits: SqlInteger,
  created_at: SqlInteger,
});
const NarrationJobRow = z.object({ document_id: z.string(), plan: z.string() });
export class ProError extends Error {}
export class ProAdmissionRejected extends ProError {
  constructor(
    message: string,
    readonly nonAcceptance: import("~/lib/generation/pro-admission").ProNonAcceptance,
  ) {
    super(message);
  }
}
export class ProLedger {
  constructor(
    readonly client: Client,
    readonly config: {
      ownerAccountIds: readonly string[];
      now: () => number;
      sandboxBillingAvailable?: boolean;
      appleSandboxAvailable?: boolean;
      narrationBook?: () => unknown;
      textBook?: () => unknown;
      imageBook?: () => unknown;
      agentBook?: () => unknown;
      supplierBooks?: () => unknown;
    },
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
    tx: Pick<Client, "execute">,
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
    transaction?: Transaction,
  ) {
    const body = async (tx: Transaction) => {
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
      const overlap = await tx.execute({
        sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<? AND ends_at>?",
        args: [input.accountId, input.endsAt, input.startsAt],
      });
      if (overlap.rows[0]) {
        const period = overlap.rows[0];
        if (!duplicatePeriod)
          throw new ProError("One allowance per period; no top-ups");
        await this.billingEvent(tx, input, String(period.id));
        return String(period.id);
      }
      // A terminal observation can arrive before any purchase has mapped to an allowance.
      // Its durable group/period row must also fence later duplicate channels for that interval.
      const fenced = await tx.execute({
        sql: "SELECT (EXISTS (SELECT 1 FROM pro_subscriptions WHERE account_id=? AND revoked=1 AND starts_at<? AND ends_at>?) OR EXISTS (SELECT 1 FROM pro_lifecycle_fences WHERE account_id=? AND starts_at<? AND ends_at>?)) AS fenced",
        args: [
          input.accountId,
          input.endsAt,
          input.startsAt,
          input.accountId,
          input.endsAt,
          input.startsAt,
        ],
      });
      if (fenced.rows[0]?.fenced === 1)
        throw new ProError("Paid period permanently fenced");
      const supplier = this.config.supplierBooks
        ? SupplierBooks.parse(this.config.supplierBooks())
        : undefined;
      const featureSchedule = (
        feature: "image" | "agent",
        candidate: unknown,
      ) => {
        if (
          !candidate ||
          !supplier?.[feature] ||
          (supplier.verification === "test-injection" &&
            input.environment !== "test")
        )
          return { status: "unavailable" };
        return { status: "available", book: candidate };
      };
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
          JSON.stringify(
            PeriodRates.parse({
              version: "period-rates-v2",
              text: this.config.textBook?.() ?? PRICEBOOK,
              narration: this.config.narrationBook?.() ?? NARRATION_BOOK,
              image: featureSchedule("image", this.config.imageBook?.()),
              agent: featureSchedule("agent", this.config.agentBook?.()),
            }),
          ),
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
    };
    return transaction ? body(transaction) : this.write(body);
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
  async billingCustomer(account: string) {
    const rows = await this.query(
      "SELECT customer_id FROM pro_billing_bindings WHERE account_id=?",
      [account],
    );
    return rows[0]
      ? z.object({ customer_id: z.string() }).parse(rows[0]).customer_id
      : null;
  }
  async bindBillingCustomer(account: string, customer: string) {
    return this.write(async (tx) => {
      const existing = (
        await tx.execute({
          sql: "SELECT * FROM pro_billing_bindings WHERE account_id=? OR customer_id=?",
          args: [account, customer],
        })
      ).rows[0];
      if (
        existing &&
        (existing.account_id !== account || existing.customer_id !== customer)
      )
        throw new ProError("Billing account binding conflict");
      await tx.execute({
        sql: "INSERT OR IGNORE INTO pro_billing_bindings VALUES (?,?,'sandbox')",
        args: [account, customer],
      });
    });
  }
  async appleAccountToken(account: string) {
    return this.write(async (tx) => {
      const eligible = await tx.execute({
        sql: "SELECT active FROM pro_eligibility WHERE account_id=?",
        args: [account],
      });
      if (eligible.rows[0]?.active !== 1)
        throw new ProError("Private eligibility required");
      await tx.execute({
        sql: "INSERT OR IGNORE INTO pro_apple_accounts VALUES (?,?)",
        args: [account, crypto.randomUUID()],
      });
      const row = (
        await tx.execute({
          sql: "SELECT token FROM pro_apple_accounts WHERE account_id=?",
          args: [account],
        })
      ).rows[0];
      return z.uuid().parse(row?.token);
    });
  }
  async appleAccount(token: string) {
    const rows = await this.query(
      "SELECT account_id FROM pro_apple_accounts WHERE token=?",
      [token],
    );
    return rows[0]
      ? z.object({ account_id: z.string() }).parse(rows[0]).account_id
      : null;
  }
  async reconcileSandbox(eventId: string, verify: () => Promise<unknown>) {
    return this.write(async (tx) => {
      if (
        (
          await tx.execute({
            sql: "SELECT event_id FROM pro_lifecycle_events WHERE event_id=?",
            args: [eventId],
          })
        ).rows.length
      )
        return;
      // Revalidation inside the account write fence prevents concurrent old snapshots from winning after revocation.
      const event = z
        .strictObject({
          accountId: z.string().min(1).max(100),
          customerId: z.string().min(1).max(200),
          subscriptionId: z.string().min(1).max(200),
          source: z.enum(["stripe", "apple"]),
          environment: z.literal("sandbox"),
          startsAt: z.number().int().nonnegative(),
          endsAt: z.number().int().positive(),
          state: z.enum([
            "active",
            "payment_failed",
            "cancelled",
            "expired",
            "revoked",
          ]),
          cancelAtEnd: z.boolean(),
        })
        .parse(await verify());
      const binding = (
        await tx.execute({
          sql: "SELECT * FROM pro_billing_bindings WHERE account_id=?",
          args: [event.accountId],
        })
      ).rows[0];
      if (
        event.source === "stripe" &&
        binding?.customer_id !== event.customerId
      )
        throw new ProError("Billing account binding conflict");
      if (event.source === "apple") {
        const apple = (
          await tx.execute({
            sql: "SELECT account_id FROM pro_apple_accounts WHERE token=?",
            args: [event.customerId],
          })
        ).rows[0];
        if (apple?.account_id !== event.accountId)
          throw new ProError("Billing account binding conflict");
      }
      const prior = (
        await tx.execute({
          sql: "SELECT * FROM pro_subscriptions WHERE source=? AND subscription_id=?",
          args: [event.source, event.subscriptionId],
        })
      ).rows[0];
      if (
        prior &&
        (prior.account_id !== event.accountId ||
          prior.customer_id !== event.customerId)
      )
        throw new ProError("Billing account binding conflict");
      const periodEventId = `${event.source}:period:${event.subscriptionId}:${event.startsAt}`;
      const stale = prior && Number(prior.starts_at) > event.startsAt;
      // The row is a purchase-group high-water mark. A fence belongs to its paid period,
      // except cancellation, which ends the provider subscription identity itself.
      const laterPeriod =
        prior &&
        event.startsAt > Number(prior.starts_at) &&
        event.startsAt >= Number(prior.ends_at);
      const groupCancelled =
        prior?.state === "cancelled" || event.state === "cancelled";
      const priorPeriodFenced = prior?.revoked === 1 && !laterPeriod;
      const terminal =
        groupCancelled ||
        priorPeriodFenced ||
        ["revoked", "expired"].includes(event.state);
      const persistedState = groupCancelled
        ? "cancelled"
        : priorPeriodFenced
          ? String(prior.state)
          : event.state;
      // Even a delayed refund must fence its own purchase, without blocking a later renewal.
      if (["revoked", "expired", "cancelled"].includes(event.state)) {
        await tx.execute({
          sql: "INSERT OR IGNORE INTO pro_lifecycle_fences VALUES (?,?,?,?,?)",
          args: [
            event.source,
            event.subscriptionId,
            event.accountId,
            event.startsAt,
            event.endsAt,
          ],
        });
        await tx.execute({
          sql: "INSERT INTO pro_period_blocks SELECT id,? FROM pro_periods WHERE id IN (SELECT period_id FROM pro_billing_events WHERE event_id=?) OR (account_id=? AND starts_at<? AND ends_at>? AND NOT EXISTS (SELECT 1 FROM pro_billing_events WHERE event_id=?)) ON CONFLICT(period_id) DO UPDATE SET reason=CASE WHEN pro_period_blocks.reason='payment_failed' THEN excluded.reason ELSE pro_period_blocks.reason END",
          args: [
            event.state,
            periodEventId,
            event.accountId,
            event.endsAt,
            event.startsAt,
            periodEventId,
          ],
        });
      }
      if (!stale || groupCancelled) {
        const keepPriorPeriod = prior && (stale || priorPeriodFenced);
        await tx.execute({
          sql: "INSERT INTO pro_subscriptions VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source,subscription_id) DO UPDATE SET state=excluded.state,starts_at=excluded.starts_at,ends_at=excluded.ends_at,cancel_at_end=excluded.cancel_at_end,revoked=excluded.revoked",
          args: [
            event.source,
            event.subscriptionId,
            event.accountId,
            event.customerId,
            persistedState,
            keepPriorPeriod ? Number(prior.starts_at) : event.startsAt,
            keepPriorPeriod ? Number(prior.ends_at) : event.endsAt,
            event.cancelAtEnd ? 1 : 0,
            terminal ? 1 : 0,
          ],
        });
        if (groupCancelled) {
          await tx.execute({
            sql: "INSERT INTO pro_period_blocks SELECT period_id,'cancelled' FROM pro_billing_events WHERE event_id=? ON CONFLICT(period_id) DO UPDATE SET reason='cancelled'",
            args: [
              keepPriorPeriod
                ? `${event.source}:period:${event.subscriptionId}:${prior.starts_at}`
                : periodEventId,
            ],
          });
        } else if (!terminal && event.state === "payment_failed") {
          const mapping = await tx.execute({
            sql: "SELECT period_id FROM pro_billing_events WHERE event_id=?",
            args: [periodEventId],
          });
          if (!mapping.rows.length) {
            const overlap = await tx.execute({
              sql: "SELECT id FROM pro_periods WHERE account_id=? AND starts_at<? AND ends_at>?",
              args: [event.accountId, event.endsAt, event.startsAt],
            });
            if (overlap.rows[0])
              await this.billingEvent(
                tx,
                { ...event, eventId: periodEventId, subcredits: 1_000_000_000 },
                String(overlap.rows[0].id),
              );
          }
          await tx.execute({
            sql: "INSERT OR IGNORE INTO pro_period_blocks SELECT period_id,'payment_failed' FROM pro_billing_events WHERE event_id=?",
            args: [periodEventId],
          });
        } else if (
          !terminal &&
          event.state === "active" &&
          event.endsAt > this.config.now() &&
          event.startsAt <= this.config.now()
        ) {
          await tx.execute({
            sql: "DELETE FROM pro_period_blocks WHERE reason='payment_failed' AND period_id IN (SELECT period_id FROM pro_billing_events WHERE event_id=?)",
            args: [periodEventId],
          });
          await this.createPeriod(
            `billing:${event.source}`,
            {
              accountId: event.accountId,
              eventId: periodEventId,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              environment: "sandbox",
              source: event.source,
              subcredits: 1_000_000_000,
              reason: "Verified current sandbox paid subscription",
            },
            true,
            tx,
          );
        }
      }
      await tx.execute({
        sql: "INSERT INTO pro_lifecycle_events VALUES (?,?,?,?)",
        args: [
          eventId,
          event.accountId,
          event.subscriptionId,
          this.config.now(),
        ],
      });
    });
  }
  async sandboxSubscription(account: string) {
    const rows = await this.query(
      "SELECT * FROM pro_subscriptions WHERE account_id=? ORDER BY starts_at DESC LIMIT 1",
      [account],
    );
    if (!rows[0]) return null;
    const row = SubscriptionRow.parse(rows[0]);
    return {
      source: row.source,
      state: row.state,
      startsAt: row.starts_at,
      expiresAt: row.ends_at,
      cancelAtEnd: row.cancel_at_end === 1,
    };
  }
  async status(account: string) {
    const [
      eligible,
      periods,
      history,
      costs,
      oldReservations,
      subscription,
      customer,
    ] = await Promise.all([
      this.query("SELECT active FROM pro_eligibility WHERE account_id=?", [
        account,
      ]),
      this.query(
        "SELECT *, EXISTS (SELECT 1 FROM pro_period_blocks WHERE period_id=pro_periods.id) AS blocked FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1",
        [account, this.config.now(), this.config.now()],
      ),
      this.query(
        "SELECT id,feature,state,quote,charged,created_at FROM pro_operations WHERE account_id=? ORDER BY CASE WHEN state IN ('reserved','running','unknown') THEN 0 ELSE 1 END,created_at DESC,id LIMIT 50",
        [account],
      ),
      this.query(
        "SELECT SUM(a.cost_nano_usd) AS known, SUM(CASE WHEN a.state='failed' OR o.state IN ('refunded','cancelled') THEN a.cost_nano_usd ELSE 0 END) AS absorbed, SUM(CASE WHEN a.cost_nano_usd IS NULL THEN a.exposure_nano_usd ELSE 0 END) AS unknown FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=?",
        [account],
      ),
      this.query(
        "SELECT SUM(reserved) AS reserved FROM pro_periods WHERE account_id=? AND ends_at<=?",
        [account, this.config.now()],
      ),
      this.sandboxSubscription(account),
      this.billingCustomer(account),
    ]);
    const period = periods[0] ? StatusPeriodRow.parse(periods[0]) : undefined;
    const eligibility = eligible[0]
      ? z.object({ active: SqlFlag }).parse(eligible[0])
      : undefined;
    const providerCosts = CostsRow.parse(costs[0]);
    const previousReserved = z
      .object({ reserved: SqlSum })
      .parse(oldReservations[0]).reserved;
    return {
      owner: this.config.ownerAccountIds.includes(account),
      publicState: "coming_soon" as const,
      liveCheckout: false as const,
      paymentEnvironment: this.config.sandboxBillingAvailable
        ? ("sandbox" as const)
        : ("disabled" as const),
      billing: {
        environment: "sandbox" as const,
        available:
          this.config.sandboxBillingAvailable === true &&
          eligibility?.active === 1,
        monthlyUsd: 12,
        monthlyCredits: 1000,
        state: subscription
          ? subscription.expiresAt <= this.config.now() &&
            subscription.state !== "revoked"
            ? "expired"
            : subscription.state
          : "none",
        cancelAtEnd: subscription?.cancelAtEnd ?? false,
        expiresAt: subscription?.expiresAt ?? null,
        customerBound: !!customer,
        source: subscription?.source ?? null,
        appleAvailable:
          this.config.appleSandboxAvailable === true &&
          eligibility?.active === 1,
      },
      eligible: eligibility?.active === 1,
      entitled: eligibility?.active === 1 && !!period && period.blocked !== 1,
      entitlementPeriodId: period && period.blocked !== 1 ? period.id : null,
      availableSubcredits: period?.blocked === 1 ? 0 : (period?.available ?? 0),
      reservedSubcredits: period?.reserved ?? 0,
      previousPeriodReservedSubcredits: previousReserved,
      renewalAt: period ? period.ends_at : null,
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
        knownNanoUsd: providerCosts.known,
        absorbedNanoUsd: providerCosts.absorbed,
        unknownExposureNanoUsd: providerCosts.unknown,
      },
      policy: trialPolicy(
        period ? decodePeriodRates(period.pricebook).text : PRICEBOOK,
      ),
      textMaximumSubcredits:
        period && period.blocked !== 1
          ? textMaximum(decodePeriodRates(period.pricebook).text)
          : null,
      autocompleteMaximumSubcredits:
        period && period.blocked !== 1
          ? textMaximum(decodePeriodRates(period.pricebook).text, true)
          : null,
      pricebook: period
        ? decodePeriodRates(period.pricebook).text
        : TextBook.parse(PRICEBOOK),
    };
  }
  async periodRates(account: string) {
    const [period] = await this.query(
      "SELECT id,pricebook FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC LIMIT 1",
      [account, this.config.now(), this.config.now()],
    );
    if (!period) return null;
    const row = z
      .object({ id: z.string(), pricebook: z.string() })
      .parse(period);
    return { id: row.id, rates: decodePeriodRates(row.pricebook) };
  }
  private async pinFeature(
    tx: Transaction,
    periodId: string,
    rates: PeriodRates,
    feature: "image" | "agent",
  ) {
    if (rates[feature].status === "available") return;
    const [prior] = (
      await tx.execute({
        sql: "SELECT pricebook FROM pro_operations WHERE period_id=? AND feature=? ORDER BY created_at,rowid LIMIT 1",
        args: [periodId, feature],
      })
    ).rows;
    // Legacy periods recover only evidence accepted before this policy. A later adapter cannot set customer prices.
    const value = prior ? JSON.parse(String(prior.pricebook)) : undefined;
    if (value === undefined) return;
    if (feature === "image")
      rates.image = { status: "available", book: ImagePricebook.parse(value) };
    else rates.agent = { status: "available", book: AgentBook.parse(value) };
  }
  async featureBook(account: string, feature: "image" | "agent") {
    return this.write(async (tx) => {
      const [period] = (
        await tx.execute({
          sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? AND EXISTS (SELECT 1 FROM pro_eligibility WHERE account_id=pro_periods.account_id AND active=1) AND NOT EXISTS (SELECT 1 FROM pro_period_blocks WHERE period_id=pro_periods.id) ORDER BY starts_at DESC LIMIT 1",
          args: [account, this.config.now(), this.config.now()],
        })
      ).rows;
      if (!period) throw new ProError("Private entitlement required");
      const rates = await this.periodSchedule(
        tx,
        String(period.id),
        String(period.pricebook),
      );
      const schedule = rates[feature];
      if (schedule.status === "unavailable")
        throw new ProError(`${feature} unavailable for this period`);
      return schedule.book;
    });
  }
  private async periodSchedule(tx: Transaction, id: string, value: string) {
    const rates = decodePeriodRates(value);
    if (
      z.object({ version: z.string() }).parse(JSON.parse(value)).version !==
      "period-rates-v2"
    ) {
      for (const feature of ["image", "agent"] as const) {
        if (rates[feature].status === "unavailable")
          await this.pinFeature(tx, id, rates, feature);
      }
      await tx.execute({
        sql: "UPDATE pro_periods SET pricebook=? WHERE id=?",
        args: [JSON.stringify(rates), id],
      });
    }
    return rates;
  }

  async audit(actor: string) {
    this.owner(actor);
    return z
      .array(AuditRow)
      .parse(await this.query("SELECT * FROM pro_audit ORDER BY id"));
  }
  async reserve(
    account: string,
    key: string,
    inputHash: string,
    feature:
      | "text"
      | "chat"
      | "autocomplete"
      | "image"
      | "narration"
      | "agent" = "text",
    imageSnapshot?: unknown,
    acceptedText?: { periodId: string; maximum: number; book: unknown },
  ) {
    const chat =
      feature === "chat" && imageSnapshot !== undefined
        ? z
            .strictObject({ documentId: z.string().min(1).max(100) })
            .parse(imageSnapshot)
        : undefined;
    const agent =
      feature === "agent"
        ? z
            .strictObject({ book: AgentBook, input: AgentInput })
            .parse(imageSnapshot)
        : undefined;
    const narration =
      feature === "narration"
        ? NarrationReservation.parse(imageSnapshot)
        : undefined;
    const imageBook =
      feature === "image" ? ImagePricebook.parse(imageSnapshot) : undefined;

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
        if (operation.input_hash !== inputHash || operation.feature !== feature)
          throw new ProError("Idempotency key conflicts with prior input");
        if (chat) {
          const bound = (
            await tx.execute({
              sql: "SELECT document_id FROM pro_chat_documents WHERE operation_id=?",
              args: [operation.id],
            })
          ).rows[0];
          if (bound?.document_id !== chat.documentId)
            throw new ProError("Chat document identity conflicts");
        }
        return operation;
      }
      const period = (
        await tx.execute({
          sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? AND NOT EXISTS (SELECT 1 FROM pro_period_blocks WHERE period_id=pro_periods.id)",
          args: [account, this.config.now(), this.config.now()],
        })
      ).rows[0];
      if (!period) throw new ProError("Private entitlement required");
      const rates = await this.periodSchedule(
        tx,
        String(period.id),
        String(period.pricebook),
      );
      if (
        acceptedText &&
        (acceptedText.periodId !== String(period.id) ||
          acceptedText.maximum !== textMaximum(rates.text) ||
          JSON.stringify(acceptedText.book) !== JSON.stringify(rates.text))
      )
        throw new ProError("Chat period or rates changed. Review a new quote.");

      const equal = (a: unknown, b: unknown) =>
        JSON.stringify(a) === JSON.stringify(b);
      if (narration && !equal(narration.book, rates.narration))
        throw new ProError("Narration rate snapshot is pinned for this period");
      if (
        imageBook &&
        !equal(
          imageBook,
          rates.image.status === "available" ? rates.image.book : null,
        )
      )
        throw new ProError("Image rate snapshot is pinned for this period");
      if (
        agent &&
        !equal(
          agent.book,
          rates.agent.status === "available" ? rates.agent.book : null,
        )
      )
        throw new ProError("Agent rate snapshot is pinned for this period");
      const quote =
        agent?.book.quote ??
        narration?.quote ??
        imageBook?.quote ??
        textMaximum(rates.text, feature === "autocomplete");
      await tx.execute({
        sql: "UPDATE pro_periods SET pricebook=? WHERE id=?",
        args: [JSON.stringify(rates), String(period.id)],
      });
      if (agent) {
        const active = (
          await tx.execute({
            sql: "SELECT id FROM pro_operations WHERE account_id=? AND feature='agent' AND state IN ('reserved','running','unknown')",
            args: [account],
          })
        ).rows;
        if (active.length)
          throw new ProError("Agent is still running or reconciling");
      }
      if (narration) {
        if (narration.periodId !== String(period.id))
          throw new ProError("Entitlement period changed. Review a new quote.");
        const active = await tx.execute({
          sql: "SELECT id FROM pro_operations WHERE account_id=? AND feature='narration' AND state IN ('reserved','running','unknown') LIMIT 1",
          args: [account],
        });
        if (active.rows.length)
          throw new ProError("Narration is still running or reconciling");
        const retries = await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM pro_operations WHERE account_id=? AND period_id=? AND input_hash=? AND feature='narration'",
          args: [account, period.id ?? "", inputHash],
        });
        if (Number(retries.rows[0]?.n ?? 0) >= rates.narration.maxRetries + 1)
          throw new ProError("Narration retry limit reached");
        for (const part of narration.plan)
          if (part.cachedAttempt) {
            const cached = await tx.execute({
              sql: "SELECT a.id FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE a.id=? AND a.chunk_hash=? AND a.state='completed' AND o.account_id=? AND o.feature='narration'",
              args: [part.cachedAttempt, part.hash, account],
            });
            if (!cached.rows.length)
              throw new ProError("Unauthorized narration cache");
          }
      }
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
        throw new ProAdmissionRejected("Request limit reached", {
          kind: "not_accepted",
          feature,
          idempotencyKey: key,
          reason: "request_limit",
        });
      if (feature === "autocomplete") {
        const active = await tx.execute({
          sql: "SELECT id FROM pro_operations WHERE account_id=? AND feature='autocomplete' AND state IN ('reserved','running','unknown') LIMIT 1",
          args: [account],
        });
        if (active.rows.length)
          throw new ProAdmissionRejected(
            "Autocomplete is still running or reconciling",
            {
              kind: "not_accepted",
              feature,
              idempotencyKey: key,
              reason: "active_autocomplete",
            },
          );
      }
      const reserved = await tx.execute({
        sql: "UPDATE pro_periods SET available=available-?,reserved=reserved+? WHERE id=? AND available>=?",
        args: [quote, quote, period.id ?? "", quote],
      });
      if (!reserved.rowsAffected)
        throw new ProAdmissionRejected("Insufficient credits", {
          kind: "not_accepted",
          feature,
          idempotencyKey: key,
          reason: "insufficient_credits",
        });
      const id = crypto.randomUUID();
      await tx.execute({
        sql: "INSERT INTO pro_operations(id,account_id,period_id,idempotency_key,input_hash,feature,state,quote,pricebook,policy,created_at) VALUES (?,?,?,?,?,?,'reserved',?,?,?,?)",
        args: [
          id,
          account,
          period.id ?? "",
          key,
          inputHash,
          feature,
          quote,
          agent
            ? JSON.stringify(agent.book)
            : narration
              ? JSON.stringify(narration.book)
              : imageBook
                ? JSON.stringify(imageBook)
                : JSON.stringify(rates.text),
          TRIAL_POLICY.version,
          this.config.now(),
        ],
      });
      if (chat)
        await tx.execute({
          sql: "INSERT INTO pro_chat_documents(operation_id,document_id) VALUES (?,?)",
          args: [id, chat.documentId],
        });
      if (agent)
        await tx.execute({
          sql: "INSERT INTO pro_agent_jobs(operation_id,document_id,request,report) VALUES (?,?,?,?)",
          args: [
            id,
            agent.input.documentId,
            JSON.stringify(agent.input),
            JSON.stringify({
              status: "pending",
              completed: [],
              incomplete: [agent.input.prompt.slice(0, 200)],
            }),
          ],
        });
      if (narration)
        await tx.execute({
          sql: "INSERT INTO pro_narration_jobs VALUES (?,?,?)",
          args: [id, narration.documentId, JSON.stringify(narration.plan)],
        });
      await tx.execute({
        sql: "INSERT INTO pro_reservations(operation_id,period_id,amount) VALUES (?,?,?)",
        args: [id, period.id ?? "", quote],
      });
      await this.entry(
        tx,
        account,
        String(period.id),
        id,
        "reservation",
        quote,
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
  async operationByKey(
    account: string,
    key: string,
    inputHash: string,
    feature: Operation["feature"],
  ) {
    const row = (
      await this.query(
        "SELECT * FROM pro_operations WHERE account_id=? AND idempotency_key=?",
        [account, key],
      )
    )[0];
    if (!row) throw new ProError("Operation not found");
    const operation = Operation.parse(row);
    if (operation.input_hash !== inputHash || operation.feature !== feature)
      throw new ProError("Idempotency key conflicts with prior input");
    return operation;
  }
  async ownedOperationByKey(
    account: string,
    key: string,
    feature: Operation["feature"],
  ) {
    const row = (
      await this.query(
        "SELECT * FROM pro_operations WHERE account_id=? AND idempotency_key=? AND feature=?",
        [account, key, feature],
      )
    )[0];
    return row ? Operation.parse(row) : null;
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
      | { kind: "image_completed"; completion: ImageCompletion }
      | {
          kind:
            | "technical_failure"
            | "cancelled"
            | "narration_completed"
            | "agent_completed";
        },
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
          sql: "SELECT * FROM pro_attempts WHERE operation_id=? AND state='completed' ORDER BY number DESC LIMIT 1",
          args: [id],
        })
      ).rows[0];
      if (completed) await this.contractForAttempt(tx, completed, true);
      // Durable completion outranks a losing executor's failure/cancellation verdict.
      // Read it under the settlement write lock so no refund can race its commit.
      const narration =
        op.feature === "narration"
          ? await this.narrationEvidence(tx, op)
          : undefined;
      const agent =
        op.feature === "agent" ? await this.agentEvidence(tx, op) : undefined;
      const completion =
        completed && op.feature !== "narration" && op.feature !== "agent"
          ? (op.feature === "image" ? ImageCompletion : Completion).parse(
              JSON.parse(String(completed.result)),
            )
          : undefined;
      const resolved = agent?.complete
        ? { kind: "agent_completed" as const }
        : narration?.complete
          ? { kind: "narration_completed" as const }
          : completion
            ? "kind" in completion
              ? { kind: "image_completed" as const, completion }
              : {
                  kind: "completed" as const,
                  text: completion.text,
                  usage: completion.usage,
                }
            : outcome;
      if (
        (resolved.kind === "image_completed") !== (op.feature === "image") &&
        ["completed", "image_completed"].includes(resolved.kind)
      )
        throw new ProError("Completion modality mismatch");
      if (
        op.feature === "narration" &&
        ["completed", "image_completed"].includes(resolved.kind)
      )
        throw new ProError("Completion modality mismatch");
      if (
        op.feature === "agent" &&
        ["completed", "image_completed", "narration_completed"].includes(
          resolved.kind,
        )
      )
        throw new ProError("Agent completion evidence required");
      if (resolved.kind === "agent_completed" && !agent?.complete)
        throw new ProError("Incomplete agent cannot settle");
      if (resolved.kind === "image_completed")
        validateImagePixels(validateImage(resolved.completion.image).bytes);
      if (resolved.kind === "narration_completed" && !narration?.complete)
        throw new ProError("Incomplete narration cannot settle");
      const charge =
        resolved.kind === "agent_completed"
          ? (agent?.charge ?? 0)
          : resolved.kind === "narration_completed"
            ? (narration?.charge ?? 0)
            : resolved.kind === "image_completed"
              ? imageCharge(resolved.completion.usage, JSON.parse(op.pricebook))
              : resolved.kind === "completed"
                ? referenceCharge(resolved.usage, JSON.parse(op.pricebook))
                : 0;
      if (charge > op.quote)
        throw new ProError("Settlement exceeds accepted quote");
      const state =
        resolved.kind === "agent_completed" ||
        resolved.kind === "completed" ||
        resolved.kind === "image_completed" ||
        resolved.kind === "narration_completed"
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
          op.feature === "agent"
            ? JSON.stringify(agent?.report)
            : resolved.kind === "narration_completed"
              ? JSON.stringify(narration?.attemptIds)
              : resolved.kind === "image_completed"
                ? JSON.stringify(resolved.completion.image)
                : resolved.kind === "completed"
                  ? resolved.text
                  : null,
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
  async agentJob(account: string, id: string) {
    const operation = await this.operation(account, id);
    if (operation.feature !== "agent")
      throw new ProError("Agent operation required");
    const row = (
      await this.query("SELECT * FROM pro_agent_jobs WHERE operation_id=?", [
        id,
      ])
    )[0];
    return {
      operation,
      input: AgentInput.parse(JSON.parse(String(row?.request))),
      report: Report.parse(JSON.parse(String(row?.report))),
    };
  }
  async recoverAgent(account: string, id: string) {
    await this.operation(account, id);
    const verdict = await this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=? AND account_id=?",
            args: [id, account],
          })
        ).rows[0],
      );
      if (
        op.feature !== "agent" ||
        !["reserved", "running", "unknown"].includes(op.state)
      )
        return "active";
      const evidence = await this.agentEvidence(tx, op);
      if (evidence.complete) return "complete";
      const row = (
        await tx.execute({
          sql: "SELECT lease_until FROM pro_agent_jobs WHERE operation_id=?",
          args: [id],
        })
      ).rows[0];
      if (
        Number(row?.lease_until ?? 0) <= 0 ||
        Number(row?.lease_until) > this.config.now()
      )
        return "active";
      const attempts = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE operation_id=? AND state IN ('started','unknown')",
          args: [id],
        })
      ).rows;
      const report = evidence.report;
      report.status = attempts.length
        ? "reconciling"
        : op.cancel_requested
          ? "cancelled"
          : "failed";
      report.reason = attempts.length
        ? "Interrupted paid work requires owner reconciliation. Saved edits remain."
        : "Interrupted action stopped. Saved edits remain.";
      await tx.execute({
        sql: "UPDATE pro_agent_jobs SET report=? WHERE operation_id=?",
        args: [JSON.stringify(report), id],
      });
      if (attempts.length) {
        await tx.execute({
          sql: "UPDATE pro_attempts SET state='unknown' WHERE operation_id=? AND state='started'",
          args: [id],
        });
        await tx.execute({
          sql: "UPDATE pro_operations SET state='unknown' WHERE id=?",
          args: [id],
        });
        return "active";
      }
      return op.cancel_requested ? "cancelled" : "failed";
    });
    if (verdict !== "active")
      await this.settle(id, {
        kind:
          verdict === "complete"
            ? "agent_completed"
            : verdict === "cancelled"
              ? "cancelled"
              : "technical_failure",
      });
  }
  async reconcileAgentStep(
    actor: string,
    id: string,
    attemptId: string,
    value: unknown,
    evidence: string,
  ) {
    this.owner(actor);
    this.reason(evidence);
    const completion = AgentCompletion.parse(value);
    await this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
      const a = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE id=? AND operation_id=?",
          args: [attemptId, id],
        })
      ).rows[0];
      if (
        op.feature !== "agent" ||
        !a ||
        !["started", "unknown"].includes(String(a.state)) ||
        !["running", "unknown"].includes(op.state)
      )
        throw new ProError("Unresolved agent step required");
      validateSupplierCompletion(
        await this.contractForAttempt(tx, a),
        completion,
      );
      if (
        completion.phase !==
          AgentAttemptDescriptor.parse(JSON.parse(String(a.chunk_hash)))
            .phase ||
        completion.actualCostNanoUsd === undefined ||
        completion.actualCostNanoUsd > Number(a.exposure_nano_usd)
      )
        throw new ProError("Agent reconciliation exceeds bound");
      await tx.execute({
        sql: "UPDATE pro_attempts SET state='completed',result=?,usage=?,cost_nano_usd=? WHERE id=?",
        args: [
          JSON.stringify(completion),
          JSON.stringify(completion.usage),
          completion.actualCostNanoUsd,
          attemptId,
        ],
      });
      await this.auditWrite(
        tx,
        actor,
        op.account_id,
        "agent_step_reconciled",
        `${attemptId}: ${evidence}`,
      );
    });
  }
  async agentLease(account: string, id: string) {
    await this.operation(account, id);
    return this.write(
      async (tx) =>
        (
          await tx.execute({
            sql: "UPDATE pro_agent_jobs SET lease_until=? WHERE operation_id=? AND lease_until<=? AND EXISTS (SELECT 1 FROM pro_operations WHERE id=? AND state IN ('reserved','running') AND cancel_requested=0)",
            args: [this.config.now() + 125000, id, this.config.now(), id],
          })
        ).rowsAffected === 1,
    );
  }
  async agentReport(account: string, id: string, report: unknown) {
    await this.operation(account, id);
    const parsed = Report.parse(report);
    await this.write(async (tx) => {
      const row = (
        await tx.execute({
          sql: "SELECT report,request FROM pro_agent_jobs WHERE operation_id=?",
          args: [id],
        })
      ).rows[0];
      if (Report.parse(JSON.parse(String(row?.report))).status === "complete")
        return;
      const receipts = (
        await tx.execute({
          sql: "SELECT receipt FROM pro_agent_edits WHERE operation_id=?",
          args: [id],
        })
      ).rows;
      if (receipts.length) {
        parsed.completed = receipts
          .map((r) =>
            z
              .object({ revision: z.number(), description: z.string() })
              .parse(JSON.parse(String(r.receipt))),
          )
          .sort((a, b) => a.revision - b.revision);
        const plan = (
          await tx.execute({
            sql: "SELECT result FROM pro_attempts WHERE operation_id=? AND state='completed' ORDER BY number LIMIT 1",
            args: [id],
          })
        ).rows[0];
        const intended = plan
          ? z
              .object({ output: z.object({ edits: z.array(z.string()) }) })
              .safeParse(JSON.parse(String(plan.result)))
          : undefined;
        parsed.incomplete = (
          intended?.success
            ? intended.data.output.edits
            : [
                AgentInput.parse(JSON.parse(String(row?.request))).prompt.slice(
                  0,
                  200,
                ),
              ]
        ).slice(parsed.completed.length);
      }
      await tx.execute({
        sql: "UPDATE pro_agent_jobs SET report=? WHERE operation_id=?",
        args: [JSON.stringify(parsed), id],
      });
    });
  }
  async agentEvidence(tx: Transaction, op: Operation) {
    const row = (
      await tx.execute({
        sql: "SELECT report FROM pro_agent_jobs WHERE operation_id=?",
        args: [op.id],
      })
    ).rows[0];
    const report = Report.parse(JSON.parse(String(row?.report)));
    const attempts = (
      await tx.execute({
        sql: "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
        args: [op.id],
      })
    ).rows;
    const book = AgentBook.parse(JSON.parse(op.pricebook));
    for (const attempt of attempts) {
      await this.contractForAttempt(tx, attempt);
      const descriptor = AgentAttemptDescriptor.parse(
        JSON.parse(String(attempt.chunk_hash)),
      );
      if (
        attempt.state === "completed" &&
        AgentCompletion.parse(JSON.parse(String(attempt.result))).phase !==
          descriptor.phase
      )
        throw new ProError("Agent step modality mismatch");
    }
    const completions = attempts
      .filter((a) => a.state === "completed")
      .map((a) => AgentCompletion.parse(JSON.parse(String(a.result))));
    const last = completions.at(-1);
    const plan = completions.find((c) => c.phase === "plan");
    const intended = plan
      ? z.object({ edits: z.array(z.string()).min(1) }).parse(plan.output).edits
      : [];
    const done =
      last?.phase === "decision" &&
      z.object({ kind: z.literal("done") }).safeParse(last.output).success;
    const complete =
      !!done &&
      intended.length > 0 &&
      report.completed.length >= intended.length;
    if (report.status === "complete" && !complete)
      throw new ProError("Complete agent evidence required");
    if (complete && report.status !== "complete") {
      report.status = "complete";
      report.incomplete = [];
      delete report.reason;
      await tx.execute({
        sql: "UPDATE pro_agent_jobs SET report=? WHERE operation_id=?",
        args: [JSON.stringify(report), op.id],
      });
    }
    const charge = Math.ceil(
      attempts
        .filter((a) => a.state === "completed")
        .reduce(
          (sum, a) =>
            sum +
            agentCharge(
              AgentCompletion.parse(JSON.parse(String(a.result))),
              book,
            ),
          0,
        ),
    );
    return { complete, charge, report };
  }
  async reconcileNarrationPart(
    actor: string,
    id: string,
    attemptId: string,
    value: NarrationPart,
    evidence: string,
  ) {
    this.owner(actor);
    this.reason(evidence);
    const completion = NarrationPart.parse(value);
    audioSeconds(completion);
    await this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
      if (
        op.feature !== "narration" ||
        !["running", "unknown"].includes(op.state)
      )
        throw new ProError("Unresolved narration required");
      const a = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE id=? AND operation_id=?",
          args: [attemptId, id],
        })
      ).rows[0];
      if (!a || !["started", "unknown"].includes(String(a.state)))
        throw new ProError("Unresolved narration part required");
      validateSupplierCompletion(
        await this.contractForAttempt(tx, a),
        completion,
      );
      if (
        completion.actualCostNanoUsd !== undefined &&
        completion.actualCostNanoUsd > Number(a.exposure_nano_usd)
      )
        throw new ProError("Invalid attempt cost");
      await tx.execute({
        sql: "UPDATE pro_attempts SET state='completed',cost_nano_usd=?,usage=?,result=? WHERE id=?",
        args: [
          completion.actualCostNanoUsd ?? null,
          JSON.stringify(completion.usage),
          JSON.stringify(completion),
          attemptId,
        ],
      });
      await tx.execute({
        sql: "UPDATE pro_operations SET state='running' WHERE id=? AND NOT EXISTS (SELECT 1 FROM pro_attempts WHERE operation_id=? AND state IN ('started','unknown'))",
        args: [id, id],
      });
      await this.auditWrite(
        tx,
        actor,
        op.account_id,
        "narration_part_reconciled",
        `${attemptId}: ${evidence}`,
      );
    });
  }
  async narrationEvidence(tx: Transaction, op: Operation) {
    const row = (
      await tx.execute({
        sql: "SELECT plan FROM pro_narration_jobs WHERE operation_id=?",
        args: [op.id],
      })
    ).rows[0];
    const plan = NarrationPlan.parse(JSON.parse(String(row?.plan)));
    const attempts = (
      await tx.execute({
        sql: "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
        args: [op.id],
      })
    ).rows;
    const attemptIds: string[] = [];
    let charge = 0;
    for (const chunk of plan) {
      const a = chunk.cachedAttempt
        ? (
            await tx.execute({
              sql: "SELECT a.* FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE a.id=? AND o.account_id=? AND a.chunk_hash=? AND a.state='completed'",
              args: [chunk.cachedAttempt, op.account_id, chunk.hash],
            })
          ).rows[0]
        : attempts.find(
            (a) => a.chunk_hash === chunk.hash && a.state === "completed",
          );
      if (!a) return { complete: false, charge: 0, attemptIds: [] };
      await this.contractForAttempt(tx, a);
      attemptIds.push(String(a.id));
    }
    for (const a of attempts)
      if (a.state === "completed")
        charge += narrationCharge(
          NarrationPart.parse(JSON.parse(String(a.result))).usage,
          JSON.parse(op.pricebook),
        );
    return { complete: true, charge, attemptIds };
  }
  async narrationPlan(account: string, id: string) {
    const op = await this.operation(account, id);
    if (op.feature !== "narration")
      throw new ProError("Narration operation required");
    const row = NarrationJobRow.parse(
      (
        await this.query(
          "SELECT * FROM pro_narration_jobs WHERE operation_id=?",
          [id],
        )
      )[0],
    );
    return {
      operation: op,
      documentId: row.document_id,
      plan: NarrationPlan.parse(JSON.parse(row.plan)),
    };
  }
  async narrationCache(account: string, hash: string) {
    const rows = await this.query(
      "SELECT a.* FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=? AND o.feature='narration' AND a.chunk_hash=? AND a.state='completed' ORDER BY a.created_at,a.id LIMIT 1",
      [account, hash],
    );
    return rows[0];
  }
  async narrationPart(account: string, attempt: string) {
    const row = (
      await this.query(
        "SELECT a.* FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=? AND a.id=? AND o.feature='narration' AND a.state='completed'",
        [account, attempt],
      )
    )[0];
    if (!row) throw new ProError("Narration part not found");
    await this.supplierContract(account, String(row.operation_id), attempt);
    return NarrationPart.parse(JSON.parse(String(row.result)));
  }
  async entries(account: string) {
    return z
      .array(EntryRow)
      .parse(
        await this.query(
          "SELECT * FROM pro_ledger WHERE account_id=? ORDER BY id",
          [account],
        ),
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
  async authorizeDispatch(id: string, attemptId: string, account: string) {
    const now = this.config.now();
    const rows = await this.query(
      `SELECT o.id FROM pro_operations o
       JOIN pro_attempts a ON a.operation_id=o.id
       JOIN pro_eligibility e ON e.account_id=o.account_id
       WHERE o.id=? AND o.account_id=? AND a.id=? AND a.state='started'
       AND o.state='running' AND o.cancel_requested=0 AND e.active=1
       AND NOT EXISTS (SELECT 1 FROM pro_period_blocks b WHERE b.period_id=o.period_id)
       AND EXISTS (SELECT 1 FROM pro_periods p WHERE p.account_id=o.account_id
         AND p.starts_at<=? AND p.ends_at>?
         AND NOT EXISTS (SELECT 1 FROM pro_period_blocks b WHERE b.period_id=p.id))`,
      [id, account, attemptId, now, now],
    );
    if (rows.length !== 1)
      throw new ProError("Parent paid-step authorization required");
    const op = await this.operation(account, id);
    const book = JSON.parse(op.pricebook);
    const elapsed =
      op.feature === "agent"
        ? AgentBook.parse(book).maxElapsedMs
        : op.feature === "narration"
          ? NarrationBook.parse(book).maxElapsedMs
          : op.feature === "image"
            ? ImagePricebook.parse(book).maxElapsedMs
            : TextBook.parse(book).maxElapsedMs;
    if (now - op.created_at >= elapsed)
      throw new ProError("Paid attempt expired");
    return this.supplierContract(account, id, attemptId);
  }
  async claimAgentDispatch(account: string, id: string, attemptId: string) {
    await this.authorizeDispatch(id, attemptId, account);
    await this.write(async (tx) => {
      const action = `agent-dispatch-v1:${attemptId}`;
      const prior = await tx.execute({
        sql: "SELECT id FROM pro_audit WHERE action=?",
        args: [action],
      });
      if (prior.rows.length)
        throw new ProError(
          "Paid dispatch already fenced; reconcile before replay",
        );
      const eligible = await tx.execute({
        sql: `SELECT o.id FROM pro_operations o JOIN pro_attempts a ON a.operation_id=o.id
          JOIN pro_eligibility e ON e.account_id=o.account_id
          WHERE o.id=? AND o.account_id=? AND o.feature='agent' AND o.state='running'
          AND o.cancel_requested=0 AND e.active=1 AND a.id=? AND a.state='started'
          AND NOT EXISTS (SELECT 1 FROM pro_period_blocks b WHERE b.period_id=o.period_id)`,
        args: [id, account, attemptId],
      });
      if (eligible.rows.length !== 1)
        throw new ProError("Parent paid-step authorization required");
      await this.auditWrite(tx, account, account, action, id);
    });
  }
  async startAttempt(id: string, chunkHash?: string) {
    return this.write(async (tx) => {
      const op = Operation.parse(
        (
          await tx.execute({
            sql: "SELECT * FROM pro_operations WHERE id=?",
            args: [id],
          })
        ).rows[0],
      );
      const imageBook =
        op.feature === "image"
          ? ImagePricebook.parse(JSON.parse(op.pricebook))
          : undefined;
      const agentBook =
        op.feature === "agent"
          ? AgentBook.parse(JSON.parse(op.pricebook))
          : undefined;
      const agentStep = agentBook
        ? AgentAttemptDescriptor.parse(JSON.parse(chunkHash ?? "null"))
        : undefined;
      const isNarration = op.feature === "narration";
      const narrationBook = isNarration
        ? NarrationBook.parse(JSON.parse(op.pricebook))
        : undefined;
      const textBook =
        !isNarration && !agentBook && !imageBook
          ? TextBook.parse(JSON.parse(op.pricebook))
          : undefined;
      if (isNarration) {
        const plan = NarrationPlan.parse(
          JSON.parse(
            String(
              (
                await tx.execute({
                  sql: "SELECT plan FROM pro_narration_jobs WHERE operation_id=?",
                  args: [id],
                })
              ).rows[0]?.plan,
            ),
          ),
        );
        if (
          !chunkHash ||
          !plan.some((p) => p.hash === chunkHash && !p.cachedAttempt)
        )
          throw new ProError("Unknown narration chunk");
      } else if (chunkHash && !agentBook)
        throw new ProError("Narration chunk required");
      const access = (
        await tx.execute({
          sql: "SELECT active FROM pro_eligibility WHERE account_id=?",
          args: [op.account_id],
        })
      ).rows[0];
      const blocked =
        (
          await tx.execute({
            sql: "SELECT period_id FROM pro_period_blocks WHERE period_id=?",
            args: [op.period_id],
          })
        ).rows.length > 0;
      if (
        blocked ||
        op.state !== "running" ||
        op.cancel_requested ||
        access?.active !== 1 ||
        this.config.now() - op.created_at >=
          (agentBook?.maxElapsedMs ??
            (isNarration
              ? (narrationBook ?? NARRATION_BOOK).maxElapsedMs
              : (imageBook?.maxElapsedMs ??
                textBook?.maxElapsedMs ??
                PRICEBOOK.maxElapsedMs)))
      )
        throw new ProError("Paid steps stopped");
      const configured = SupplierBooks.parse(this.config.supplierBooks?.());
      const [period] = (
        await tx.execute({
          sql: "SELECT environment FROM pro_periods WHERE id=?",
          args: [op.period_id],
        })
      ).rows;
      if (
        configured.verification === "test-injection" &&
        period?.environment !== "test"
      )
        throw new ProError("Synthetic supplier requires test entitlement");
      const supplierBook =
        configured[
          op.feature === "chat" || op.feature === "autocomplete"
            ? "text"
            : op.feature
        ];
      if (!supplierBook)
        throw new ProError("Verified supplier contract unavailable");
      const contract = makeSupplierContract(
        op.feature,
        supplierBook,
        configured.verification,
        agentStep?.phase,
      );
      const exposure = contract.maximumNanoUsd;
      const attempts = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
          args: [id],
        })
      ).rows;
      if (
        attempts.length >=
          (agentBook?.maxAttempts ??
            (isNarration
              ? (narrationBook ?? NARRATION_BOOK).maxAttempts
              : (imageBook?.maxAttempts ??
                (op.feature === "autocomplete"
                  ? 1
                  : (textBook?.maxAttempts ?? PRICEBOOK.maxAttempts))))) ||
        (agentBook
          ? attempts.some(
              (a) => a.state !== "completed" || a.chunk_hash === chunkHash,
            )
          : isNarration
            ? attempts.some(
                (a) => a.state !== "completed" || a.chunk_hash === chunkHash,
              )
            : attempts.some((a) => a.state !== "failed"))
      )
        throw new ProError("Attempt limit or unresolved outcome");
      if (agentBook && agentStep) {
        const supplierAgent = AgentBook.parse(contract.book);
        const steps = attempts.map((a) =>
          AgentAttemptDescriptor.parse(JSON.parse(String(a.chunk_hash))),
        );
        const toolPhases = [
          "generation",
          "search",
          "image",
          "sandbox",
          "delegate_plan",
        ];
        if (
          toolPhases.includes(agentStep.phase) &&
          steps.filter((s) => toolPhases.includes(s.phase)).length >=
            agentBook.maxTools
        )
          throw new ProError("Parent tool cap exhausted");
        const cyclePhases = [
          "decision",
          "delegate_plan",
          "delegate_generation",
        ];
        if (
          cyclePhases.includes(agentStep.phase) &&
          steps.filter((s) => cyclePhases.includes(s.phase)).length >=
            agentBook.maxCycles
        )
          throw new ProError("Parent agent cycle cap exhausted");
        const nested = /^delegate:([0-5]):(plan|sandbox|generation)$/.exec(
          agentStep.key,
        );
        if (agentStep.phase.startsWith("delegate_") || nested) {
          if (!agentBook.delegation || !supplierAgent.delegation || !nested)
            throw new ProError("Delegated parent contract required");
          const expected =
            nested[2] === "sandbox" ? "sandbox" : `delegate_${nested[2]}`;
          if (agentStep.phase !== expected)
            throw new ProError("Delegated phase mismatch");
          if (agentStep.phase === "delegate_plan") {
            if (
              steps.filter((s) => s.phase === "delegate_plan").length >=
              agentBook.delegation.maxCalls
            )
              throw new ProError("Delegated call cap exhausted");
          } else {
            const parentKey = `delegate:${nested[1]}:plan`;
            if (
              !steps.some(
                (s) => s.key === parentKey && s.phase === "delegate_plan",
              )
            )
              throw new ProError("Delegated plan required");
          }
        }
        if (steps.some((s) => s.key === agentStep.key))
          throw new ProError("Paid step already admitted");
        const count = steps.filter((s) =>
          ["search", "image", "sandbox"].includes(agentStep.phase)
            ? s.phase === agentStep.phase
            : !["search", "image", "sandbox"].includes(s.phase),
        ).length;
        if (
          !exposure ||
          count >=
            (agentStep.phase === "search"
              ? agentBook.maxSearchSteps
              : agentStep.phase === "image"
                ? agentBook.maxImageSteps
                : agentStep.phase === "sandbox"
                  ? (agentBook.sandbox?.maxSteps ?? 0)
                  : agentBook.maxTextSteps) ||
          attempts.reduce(
            (sum, a) => sum + Number(a.exposure_nano_usd),
            exposure,
          ) > supplierAgent.maximumNanoUsd
        )
          throw new ProError("Action cap exhausted");
      }
      const historical = (
        await tx.execute({
          sql: "SELECT a.* FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE (o.account_id=? AND o.period_id=?) OR a.created_at>?",
          args: [op.account_id, op.period_id, this.config.now() - 86400000],
        })
      ).rows;
      for (const a of historical) {
        await this.contractForAttempt(tx, a, true);
        const cost = a.cost_nano_usd;
        if (
          cost !== null &&
          (!Number.isSafeInteger(Number(cost)) ||
            Number(cost) < 0 ||
            Number(cost) > Number(a.exposure_nano_usd))
        )
          throw new ProError("Corrupt historical supplier cost");
      }
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
        Number(failureSpend?.spend ?? 0) + exposure >
          PRICEBOOK.accountFailureSpendNanoUsd ||
        Number(accountSpend?.spend ?? 0) + exposure >
          PRICEBOOK.accountSpendNanoUsd ||
        Number(globalSpend?.spend ?? 0) + exposure >
          PRICEBOOK.globalDailySpendNanoUsd ||
        Number(failures?.failures ?? 0) >= 5
      )
        throw new ProError("Provider spend circuit open");
      const attempt = crypto.randomUUID();
      await tx.execute({
        sql:
          isNarration || agentBook
            ? "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,created_at,chunk_hash) VALUES (?,?,?,'started',?,?,?)"
            : "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,created_at) VALUES (?,?,?,'started',?,?)",
        args:
          isNarration || agentBook
            ? [
                attempt,
                id,
                attempts.length + 1,
                exposure,
                this.config.now(),
                chunkHash ?? null,
              ]
            : [attempt, id, attempts.length + 1, exposure, this.config.now()],
      });
      // The existing append-only audit table makes this snapshot immutable and atomic with its paid fence, without a remote schema migration.
      await this.auditWrite(
        tx,
        "supplier-contract",
        op.account_id,
        `supplier-attempt:${attempt}`,
        JSON.stringify(contract),
      );
      return attempt;
    });
  }
  async supplierContract(
    account: string,
    operationId: string,
    attemptId: string,
  ) {
    await this.operation(account, operationId);
    const [attempt] = await this.query(
      "SELECT * FROM pro_attempts WHERE id=? AND operation_id=?",
      [attemptId, operationId],
    );
    if (!attempt) throw new ProError("Attempt not found");
    return this.contractForAttempt(this.client, attempt);
  }

  private async contractForAttempt(
    tx: Pick<Client, "execute">,
    attempt: Awaited<ReturnType<ProLedger["query"]>>[number],
    materializeHistorical = false,
  ) {
    const op = Operation.parse(
      (
        await tx.execute({
          sql: "SELECT * FROM pro_operations WHERE id=?",
          args: [attempt.operation_id ?? ""],
        })
      ).rows[0],
    );
    const rows = (
      await tx.execute({
        sql: "SELECT reason FROM pro_audit WHERE action=? AND account_id=?",
        args: [`supplier-attempt:${attempt.id}`, op.account_id],
      })
    ).rows;
    if (rows.length > 1) throw new ProError("Ambiguous supplier contract");
    const phase =
      op.feature === "agent"
        ? AgentAttemptDescriptor.parse(JSON.parse(String(attempt.chunk_hash)))
            .phase
        : undefined;
    const contract = rows[0]
      ? SupplierContract.parse(JSON.parse(String(rows[0].reason)))
      : archivedSupplier(op.feature, JSON.parse(String(op.pricebook)), phase);
    // Historical autocomplete reserved the full v1 text ceiling, which remains the paid exposure.
    const historicalAutocomplete =
      !rows[0] &&
      op.feature === "autocomplete" &&
      Number(attempt.exposure_nano_usd) ===
        supplierMaximum("text", PRICEBOOK_V1);
    const historicalChatCeiling =
      !rows[0] &&
      op.feature === "chat" &&
      Number(attempt.exposure_nano_usd) ===
        supplierMaximum("text", PRICEBOOK_V1);
    if (
      contract.feature !== op.feature ||
      (contract.feature === "agent" ? contract.phase : undefined) !== phase ||
      (!historicalAutocomplete &&
        !historicalChatCeiling &&
        contract.maximumNanoUsd !== Number(attempt.exposure_nano_usd))
    )
      throw new ProError("Supplier contract differs from paid fence");
    if (attempt.state === "completed")
      validateSupplierCompletion(contract, JSON.parse(String(attempt.result)));
    // The old chat adapter dispatched the operation book, but recorded the compiled v1 ceiling. Recover that known dispatch contract; do not alter customer rates.
    if (historicalChatCeiling && materializeHistorical) {
      await tx.execute({
        sql: "UPDATE pro_attempts SET exposure_nano_usd=? WHERE id=?",
        args: [contract.maximumNanoUsd, attempt.id ?? ""],
      });
      await this.auditWrite(
        tx,
        "supplier-contract",
        op.account_id,
        `supplier-attempt:${attempt.id}`,
        JSON.stringify(contract),
      );
      attempt.exposure_nano_usd = contract.maximumNanoUsd;
    }
    return contract;
  }
  async finishAttempt(
    id: string,
    outcome:
      | {
          kind: "completed";
          completion:
            | Completion
            | ImageCompletion
            | NarrationPart
            | AgentCompletion;
        }
      | { kind: "failed" | "unknown"; actualCostNanoUsd?: number },
  ) {
    await this.write(async (tx) => {
      const attempt = (
        await tx.execute({
          sql: "SELECT * FROM pro_attempts WHERE id=?",
          args: [id],
        })
      ).rows[0];
      if (!attempt) return;
      const [operation] = (
        await tx.execute({
          sql: "SELECT feature,pricebook FROM pro_operations WHERE id=?",
          args: [attempt.operation_id ?? ""],
        })
      ).rows;
      if (
        attempt.state !== "started" &&
        !(
          ["narration", "agent"].includes(String(operation?.feature)) &&
          attempt.state === "unknown" &&
          outcome.kind === "completed"
        )
      )
        return;
      const contract = await this.contractForAttempt(tx, attempt, true);
      const descriptor =
        operation?.feature === "agent"
          ? AgentAttemptDescriptor.parse(JSON.parse(String(attempt.chunk_hash)))
          : undefined;
      const completed =
        outcome.kind === "completed"
          ? (operation?.feature === "agent"
              ? AgentCompletion
              : operation?.feature === "narration"
                ? NarrationPart
                : operation?.feature === "image"
                  ? ImageCompletion
                  : Completion
            ).parse(outcome.completion)
          : undefined;
      if (
        completed &&
        "kind" in completed &&
        completed.kind !== "agent" &&
        completed.kind !== "narration_part"
      ) {
        validateImage(completed.image);
        imageCharge(completed.usage, JSON.parse(String(operation?.pricebook)));
      }
      if (
        completed &&
        "kind" in completed &&
        completed.kind === "narration_part"
      )
        audioSeconds(completed);
      if (
        completed &&
        "kind" in completed &&
        completed.kind === "agent" &&
        completed.phase !== descriptor?.phase
      )
        throw new ProError("Agent step modality mismatch");
      if (
        completed &&
        "kind" in completed &&
        completed.kind === "agent" &&
        completed.estimatedCostNanoUsd !== undefined &&
        completed.estimatedCostNanoUsd > Number(attempt.exposure_nano_usd)
      )
        throw new ProError("Estimated supplier spend exceeds bound");
      if (completed) validateSupplierCompletion(contract, completed);
      let cost =
        completed?.actualCostNanoUsd ??
        (outcome.kind !== "completed" ? outcome.actualCostNanoUsd : undefined);
      if (
        cost !== undefined &&
        (!Number.isSafeInteger(cost) ||
          cost < 0 ||
          cost > Number(attempt.exposure_nano_usd))
      ) {
        if (outcome.kind === "failed") cost = undefined;
        else throw new ProError("Invalid attempt cost");
      }
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
      if (
        ["narration", "agent"].includes(String(operation?.feature)) &&
        outcome.kind === "completed"
      )
        await tx.execute({
          sql: "UPDATE pro_operations SET state='running' WHERE id=? AND state='unknown' AND NOT EXISTS (SELECT 1 FROM pro_attempts WHERE operation_id=? AND state IN ('started','unknown'))",
          args: [attempt.operation_id ?? "", attempt.operation_id ?? ""],
        });
      if (outcome.kind === "unknown")
        await tx.execute({
          sql: "UPDATE pro_operations SET state='unknown' WHERE id=?",
          args: [attempt.operation_id ?? ""],
        });
    });
  }
  async attempts(account: string, id: string) {
    const op = await this.operation(account, id);
    const attempts = z
      .array(AttemptRow)
      .parse(
        await this.query(
          "SELECT * FROM pro_attempts WHERE operation_id=? ORDER BY number",
          [id],
        ),
      );
    if (op.feature === "agent")
      for (const attempt of attempts)
        AgentAttemptDescriptor.parse(JSON.parse(attempt.chunk_hash ?? ""));
    return attempts;
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
          sql: "SELECT a.*,o.account_id FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE a.id=?",
          args: [attemptId],
        })
      ).rows[0];
      if (!attempt || attempt.state === "started")
        throw new ProError(
          "Resolve provider outcome before reconciling invoice cost",
        );
      await this.contractForAttempt(tx, attempt, true);
      if (costNanoUsd > Number(attempt.exposure_nano_usd))
        throw new ProError("Invoice exceeds admitted supplier exposure");
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
