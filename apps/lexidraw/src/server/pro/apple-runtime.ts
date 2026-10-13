import "server-only";
import {
  appleSandboxToken,
  createAppleSandboxStatusAPI,
} from "./apple-transport";
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
    // Expose only reads. No API mutations or production-environment fallback.
    return new AppleSandboxBilling(
      proLedger(),
      {
        bundleId: APPLE_BUNDLE,
        productId: APPLE_PRODUCT,
        subscriptionGroupId: config.APPLE_SANDBOX_SUBSCRIPTION_GROUP_ID,
      },
      productionAppleVerifier(),
      createAppleSandboxStatusAPI({
        token: () =>
          appleSandboxToken({
            key: config.APPLE_SANDBOX_KEY,
            keyId: config.APPLE_SANDBOX_KEY_ID,
            issuerId: config.APPLE_SANDBOX_ISSUER_ID,
            bundleId: APPLE_BUNDLE,
          }),
        fetch: globalThis.fetch,
      }),
    );
  } catch {
    throw new ProError("Apple sandbox billing unavailable");
  }
}
