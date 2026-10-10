import "server-only";
import {
  AppStoreServerAPIClient,
  Environment,
} from "@apple/app-store-server-library";
import { AppleSandboxBilling } from "./apple-billing";
import {
  APPLE_BUNDLE,
  APPLE_PRODUCT,
  appleSandboxConfig,
  productionAppleVerifier,
} from "./apple-runtime-config";
import { ProError } from "./ledger";
import { proLedger } from "./runtime";
export function appleSandboxBilling() {
  const config = appleSandboxConfig(process.env);
  if (!config) throw new ProError("Apple sandbox billing unavailable");
  try {
    const client = new AppStoreServerAPIClient(
      config.APPLE_SANDBOX_KEY,
      config.APPLE_SANDBOX_KEY_ID,
      config.APPLE_SANDBOX_ISSUER_ID,
      APPLE_BUNDLE,
      Environment.SANDBOX,
    );
    // Expose only reads. No API mutations or production-environment fallback.
    return new AppleSandboxBilling(
      proLedger(),
      {
        bundleId: APPLE_BUNDLE,
        productId: APPLE_PRODUCT,
        subscriptionGroupId: config.APPLE_SANDBOX_SUBSCRIPTION_GROUP_ID,
      },
      productionAppleVerifier(),
      {
        getTransactionInfo: (id) => client.getTransactionInfo(id),
        getAllSubscriptionStatuses: (id) =>
          client.getAllSubscriptionStatuses(id),
      },
    );
  } catch {
    throw new ProError("Apple sandbox billing unavailable");
  }
}
