import {
  AgentBook,
  AgentInput,
  AgentCompletion,
  Report,
  agentCharge,
  type Phase,
} from "~/lib/agent/contracts";
import { audioSeconds } from "./narration-audio";
import {
  NARRATION_BOOK,
  CHUNK_MAXIMUM,
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
  TRIAL_POLICY,
  TEXT_QUOTE,
  AUTOCOMPLETE_QUOTE,
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
    readonly config: {
      ownerAccountIds: readonly string[];
      now: () => number;
      sandboxBillingAvailable?: boolean;
      appleSandboxAvailable?: boolean;
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
    return rows[0] ? String(rows[0].customer_id) : null;
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
    return rows[0] ? String(rows[0].account_id) : null;
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
    const row = rows[0];
    return row
      ? {
          source: z.enum(["apple", "stripe"]).parse(row.source),
          state: String(row.state),
          startsAt: Number(row.starts_at),
          expiresAt: Number(row.ends_at),
          cancelAtEnd: row.cancel_at_end === 1,
        }
      : null;
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
        "SELECT SUM(a.cost_nano_usd) AS known, SUM(CASE WHEN o.state IN ('refunded','cancelled') THEN a.cost_nano_usd ELSE 0 END) AS absorbed, SUM(CASE WHEN a.cost_nano_usd IS NULL THEN a.exposure_nano_usd ELSE 0 END) AS unknown FROM pro_attempts a JOIN pro_operations o ON o.id=a.operation_id WHERE o.account_id=?",
        [account],
      ),
      this.query(
        "SELECT SUM(reserved) AS reserved FROM pro_periods WHERE account_id=? AND ends_at<=?",
        [account, this.config.now()],
      ),
      this.sandboxSubscription(account),
      this.billingCustomer(account),
    ]);
    const period = periods[0];
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
          eligible[0]?.active === 1,
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
          eligible[0]?.active === 1,
      },
      eligible: eligible[0]?.active === 1,
      entitled: eligible[0]?.active === 1 && !!period && period.blocked !== 1,
      entitlementPeriodId:
        period && period.blocked !== 1 ? String(period.id) : null,
      availableSubcredits:
        period?.blocked === 1 ? 0 : Number(period?.available ?? 0),
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
        absorbedNanoUsd: Number(costs[0]?.absorbed ?? 0),
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
  async reserve(
    account: string,
    key: string,
    inputHash: string,
    feature: "text" | "autocomplete" | "image" | "narration" | "agent" = "text",
    imageSnapshot?: unknown,
  ) {
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
    const quote =
      agent?.book.quote ??
      narration?.quote ??
      imageBook?.quote ??
      (feature === "autocomplete" ? AUTOCOMPLETE_QUOTE : TEXT_QUOTE);
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
        return operation;
      }
      const period = (
        await tx.execute({
          sql: "SELECT * FROM pro_periods WHERE account_id=? AND starts_at<=? AND ends_at>? AND NOT EXISTS (SELECT 1 FROM pro_period_blocks WHERE period_id=pro_periods.id)",
          args: [account, this.config.now(), this.config.now()],
        })
      ).rows[0];
      if (!period) throw new ProError("Private entitlement required");
      if (agent) {
        const pinned = (
          await tx.execute({
            sql: "SELECT pricebook FROM pro_operations WHERE period_id=? AND feature='agent' LIMIT 1",
            args: [period.id ?? ""],
          })
        ).rows[0];
        if (pinned && String(pinned.pricebook) !== JSON.stringify(agent.book))
          throw new ProError("Agent rate snapshot is pinned for this period");
        const active = (
          await tx.execute({
            sql: "SELECT id FROM pro_operations WHERE account_id=? AND feature='agent' AND state IN ('reserved','running','unknown')",
            args: [account],
          })
        ).rows;
        if (active.length)
          throw new ProError("Agent is still running or reconciling");
      }
      if (imageBook) {
        const pinned = (
          await tx.execute({
            sql: "SELECT pricebook FROM pro_operations WHERE period_id=? AND feature='image' ORDER BY created_at,id LIMIT 1",
            args: [period.id ?? ""],
          })
        ).rows[0];
        if (pinned && String(pinned.pricebook) !== JSON.stringify(imageBook))
          throw new ProError("Image rate snapshot is pinned for this period");
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
        if (Number(retries.rows[0]?.n ?? 0) >= NARRATION_BOOK.maxRetries + 1)
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
        throw new ProError("Request limit reached");
      if (feature === "autocomplete") {
        const active = await tx.execute({
          sql: "SELECT id FROM pro_operations WHERE account_id=? AND feature='autocomplete' AND state IN ('reserved','running','unknown') LIMIT 1",
          args: [account],
        });
        if (active.rows.length)
          throw new ProError("Autocomplete is still running or reconciling");
      }
      const reserved = await tx.execute({
        sql: "UPDATE pro_periods SET available=available-?,reserved=reserved+? WHERE id=? AND available>=?",
        args: [quote, quote, period.id ?? "", quote],
      });
      if (!reserved.rowsAffected) throw new ProError("Insufficient credits");
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
                : String(period.pricebook),
          TRIAL_POLICY.version,
          this.config.now(),
        ],
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
          sql: "SELECT result FROM pro_attempts WHERE operation_id=? AND state='completed' ORDER BY number DESC LIMIT 1",
          args: [id],
        })
      ).rows[0];
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
      if (
        completion.phase !== JSON.parse(String(a.chunk_hash)).phase ||
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
      if (completion.actualCostNanoUsd > Number(a.exposure_nano_usd))
        throw new ProError("Invalid attempt cost");
      await tx.execute({
        sql: "UPDATE pro_attempts SET state='completed',cost_nano_usd=?,usage=?,result=? WHERE id=?",
        args: [
          completion.actualCostNanoUsd,
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
    const row = (
      await this.query(
        "SELECT * FROM pro_narration_jobs WHERE operation_id=?",
        [id],
      )
    )[0];
    return {
      operation: op,
      documentId: String(row?.document_id),
      plan: NarrationPlan.parse(JSON.parse(String(row?.plan))),
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
    return NarrationPart.parse(JSON.parse(String(row.result)));
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
        ? z
            .strictObject({
              key: z.string().max(100),
              phase: z.enum([
                "plan",
                "decision",
                "generation",
                "search",
                "image",
              ]),
              hash: z.string().length(64),
            })
            .parse(JSON.parse(chunkHash ?? "null"))
        : undefined;
      const isNarration = op.feature === "narration";
      const exposure =
        agentBook && agentStep
          ? agentStep.phase === "image"
            ? (agentBook.image?.maximumNanoUsd ?? 0)
            : agentStep.phase === "search"
              ? agentBook.searchMaximumNanoUsd
              : agentBook.textMaximumNanoUsd
          : isNarration
            ? CHUNK_MAXIMUM * 3
            : (imageBook?.maximumNanoUsd ?? MAX_ATTEMPT_NANO_USD);
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
              ? NARRATION_BOOK.maxElapsedMs
              : (imageBook?.maxElapsedMs ?? PRICEBOOK.maxElapsedMs)))
      )
        throw new ProError("Paid steps stopped");
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
              ? NARRATION_BOOK.maxAttempts
              : (imageBook?.maxAttempts ??
                (op.feature === "autocomplete"
                  ? 1
                  : PRICEBOOK.maxAttempts)))) ||
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
        const steps = attempts.map(
          (a) => JSON.parse(String(a.chunk_hash)) as { phase: Phase },
        );
        const count = steps.filter((s) =>
          agentStep.phase === "search" || agentStep.phase === "image"
            ? s.phase === agentStep.phase
            : !["search", "image"].includes(s.phase),
        ).length;
        if (
          !exposure ||
          count >=
            (agentStep.phase === "search"
              ? agentBook.maxSearchSteps
              : agentStep.phase === "image"
                ? agentBook.maxImageSteps
                : agentBook.maxTextSteps) ||
          steps.reduce(
            (sum, s) =>
              sum +
              (s.phase === "image"
                ? (agentBook.image?.maximumNanoUsd ?? 0)
                : s.phase === "search"
                  ? agentBook.searchMaximumNanoUsd
                  : agentBook.textMaximumNanoUsd),
            exposure,
          ) > agentBook.maximumNanoUsd
        )
          throw new ProError("Action cap exhausted");
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
      return attempt;
    });
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
        completed.phase !== JSON.parse(String(attempt.chunk_hash)).phase
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
      const cost =
        completed?.actualCostNanoUsd ??
        (outcome.kind !== "completed" ? outcome.actualCostNanoUsd : undefined);
      if (
        cost !== undefined &&
        (!Number.isSafeInteger(cost) ||
          cost < 0 ||
          cost > Number(attempt.exposure_nano_usd))
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
