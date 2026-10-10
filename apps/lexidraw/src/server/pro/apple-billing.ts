import { randomUUID } from "node:crypto";
import type { SignedDataVerifier } from "@apple/app-store-server-library";
import { z } from "zod";
import { ProError, type ProLedger } from "./ledger";
export type AppleSandboxConfig = {
  bundleId: string;
  productId: string;
  subscriptionGroupId: string;
};
export type AppleStatusAPI = {
  getTransactionInfo(id: string): Promise<unknown>;
  getAllSubscriptionStatuses(id: string): Promise<unknown>;
};
const Id = z.string().regex(/^\d{1,80}$/);
const Signed = z.string().min(1).max(64000);
const Transaction = z.object({
  transactionId: Id,
  originalTransactionId: Id,
  bundleId: z.string(),
  productId: z.string(),
  subscriptionGroupIdentifier: z.string(),
  appAccountToken: z.uuid(),
  environment: z.literal("Sandbox"),
  type: z.literal("Auto-Renewable Subscription"),
  inAppOwnershipType: z.literal("PURCHASED"),
  quantity: z.literal(1),
  purchaseDate: z.number().int().nonnegative(),
  expiresDate: z.number().int().positive(),
  signedDate: z.number().int().positive(),
  revocationDate: z.number().int().positive().optional(),
  isUpgraded: z.literal(false).optional(),
});
const Renewal = z.object({
  environment: z.literal("Sandbox"),
  originalTransactionId: Id,
  productId: z.string(),
  autoRenewProductId: z.string(),
  autoRenewStatus: z.union([z.literal(0), z.literal(1)]),
  isInBillingRetryPeriod: z.boolean(),
  signedDate: z.number().int().positive(),
});
export class AppleSandboxBilling {
  constructor(
    private readonly ledger: ProLedger,
    readonly config: AppleSandboxConfig,
    private readonly verifier: SignedDataVerifier,
    private readonly api: AppleStatusAPI,
    private readonly now: () => number = Date.now,
  ) {}
  async gate(account: string) {
    const appAccountToken = await this.ledger.appleAccountToken(account);
    return {
      available: true as const,
      environment: "sandbox" as const,
      appAccountToken,
      productId: this.config.productId,
      bundleId: this.config.bundleId,
    };
  }
  private async transaction(jws: string) {
    const t = Transaction.parse(
      await this.verifier.verifyAndDecodeTransaction(Signed.parse(jws)),
    );
    if (
      t.bundleId !== this.config.bundleId ||
      t.productId !== this.config.productId ||
      t.subscriptionGroupIdentifier !== this.config.subscriptionGroupId ||
      t.expiresDate <= t.purchaseDate ||
      t.expiresDate - t.purchaseDate > 32 * 86400000 ||
      t.signedDate > this.now() + 60000
    )
      throw new Error();
    return t;
  }
  async claim(account: string, jws: string) {
    await this.gate(account);
    try {
      const presented = await this.transaction(jws);
      if (
        (await this.ledger.appleAccount(presented.appAccountToken)) !== account
      )
        throw new Error();
      const revoked = await this.reconcile(
        `apple:claim:${randomUUID()}`,
        presented,
        account,
        "claim",
      );
      if (revoked)
        await this.reconcile(
          `apple:refresh:${randomUUID()}`,
          presented,
          account,
        );
      return this.ledger.status(account);
    } catch {
      throw new ProError("Apple sandbox transaction rejected");
    }
  }
  private async reconcile(
    eventId: string,
    presented: z.infer<typeof Transaction>,
    account: string,
    mode: "current" | "revocation" | "claim" = "current",
  ) {
    let foundRevocation = false;
    await this.ledger.reconcileSandbox(eventId, async () => {
      const info = z
        .object({ signedTransactionInfo: Signed })
        .parse(await this.api.getTransactionInfo(presented.transactionId));
      const purchased = await this.transaction(info.signedTransactionInfo);
      if (
        purchased.transactionId !== presented.transactionId ||
        purchased.originalTransactionId !== presented.originalTransactionId ||
        purchased.appAccountToken !== presented.appAccountToken ||
        purchased.purchaseDate !== presented.purchaseDate ||
        purchased.expiresDate !== presented.expiresDate
      )
        throw new Error();
      const response = z
        .object({
          environment: z.literal("Sandbox"),
          bundleId: z.literal(this.config.bundleId),
          data: z
            .array(
              z.object({
                subscriptionGroupIdentifier: z.string(),
                lastTransactions: z
                  .array(
                    z.object({
                      originalTransactionId: Id,
                      status: z.number().int().min(1).max(5),
                      signedTransactionInfo: Signed,
                      signedRenewalInfo: Signed,
                    }),
                  )
                  .max(100),
              }),
            )
            .max(100),
        })
        .parse(
          await this.api.getAllSubscriptionStatuses(
            purchased.originalTransactionId,
          ),
        );
      const matches = response.data
        .filter(
          (g) =>
            g.subscriptionGroupIdentifier === this.config.subscriptionGroupId,
        )
        .flatMap((g) => g.lastTransactions)
        .filter(
          (t) => t.originalTransactionId === purchased.originalTransactionId,
        );
      if (matches.length !== 1 || !matches[0]) throw new Error();
      const current = matches[0];
      const t = await this.transaction(current.signedTransactionInfo);
      const renewal = Renewal.parse(
        await this.verifier.verifyAndDecodeRenewalInfo(
          current.signedRenewalInfo,
        ),
      );
      if (
        t.originalTransactionId !== purchased.originalTransactionId ||
        t.appAccountToken !== purchased.appAccountToken ||
        renewal.originalTransactionId !== t.originalTransactionId ||
        renewal.productId !== this.config.productId ||
        renewal.autoRenewProductId !== this.config.productId ||
        renewal.signedDate > this.now() + 60000 ||
        this.now() - renewal.signedDate > 300000 ||
        this.now() - t.signedDate > 300000
      )
        throw new Error();
      foundRevocation = purchased.revocationDate !== undefined;
      const terminal =
        mode === "revocation" || (mode === "claim" && foundRevocation);
      const paid = terminal ? purchased : t;
      if (mode === "revocation" && !purchased.revocationDate) throw new Error();
      const state =
        paid.revocationDate || (current.status === 5 && !terminal)
          ? "revoked"
          : current.status === 3 ||
              current.status === 4 ||
              renewal.isInBillingRetryPeriod
            ? "payment_failed"
            : paid.expiresDate <= this.now() || current.status === 2
              ? "expired"
              : current.status === 1
                ? "active"
                : "payment_failed";
      return {
        accountId: account,
        customerId: paid.appAccountToken,
        subscriptionId: paid.originalTransactionId,
        source: "apple",
        environment: "sandbox",
        startsAt: paid.purchaseDate,
        endsAt: paid.expiresDate,
        state,
        cancelAtEnd: renewal.autoRenewStatus === 0,
      };
    });
    return foundRevocation;
  }
  async notification(jws: string) {
    try {
      const n = z
        .object({
          notificationUUID: z.uuid(),
          notificationType: z.string(),
          signedDate: z.number().int().positive(),
          data: z.object({ signedTransactionInfo: Signed }),
        })
        .parse(
          await this.verifier.verifyAndDecodeNotification(Signed.parse(jws)),
        );
      if (n.signedDate > this.now() + 60000) throw new Error();
      const transaction = await this.transaction(n.data.signedTransactionInfo);
      const account = await this.ledger.appleAccount(
        transaction.appAccountToken,
      );
      if (!account) throw new Error();
      if (["REFUND", "REVOKE"].includes(n.notificationType))
        await this.reconcile(
          `apple:terminal:${n.notificationUUID}`,
          transaction,
          account,
          "revocation",
        );
      await this.reconcile(
        `apple:notification:${n.notificationUUID}`,
        transaction,
        account,
      );
    } catch {
      throw new ProError("Apple sandbox event rejected");
    }
  }
}
