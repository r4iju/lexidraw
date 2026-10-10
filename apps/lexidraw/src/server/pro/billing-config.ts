import type { SandboxConfig } from "./billing";
export function sandboxConfig(
  environment: Readonly<Record<string, string | undefined>>,
): SandboxConfig | null {
  if (environment.STRIPE_SANDBOX_ENABLED !== "true") return null;
  const config = {
    key: environment.STRIPE_SANDBOX_SECRET_KEY ?? "",
    webhookSecret: environment.STRIPE_SANDBOX_WEBHOOK_SECRET ?? "",
    priceId: environment.STRIPE_SANDBOX_PRICE_ID ?? "",
    productId: environment.STRIPE_SANDBOX_PRODUCT_ID ?? "",
    origin: environment.STRIPE_SANDBOX_APP_ORIGIN ?? "",
    portalConfigurationId:
      environment.STRIPE_SANDBOX_PORTAL_CONFIGURATION_ID ?? "",
  };
  if (
    !/^sk_test_[A-Za-z0-9_]+$/.test(config.key) ||
    !config.webhookSecret.startsWith("whsec_") ||
    !config.priceId.startsWith("price_") ||
    !config.productId.startsWith("prod_") ||
    !config.portalConfigurationId.startsWith("bpc_")
  )
    return null;
  try {
    const origin = new URL(config.origin);
    if (
      origin.origin !== config.origin ||
      origin.username ||
      origin.password ||
      !(
        origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname))
      )
    )
      return null;
  } catch {
    return null;
  }
  return config;
}
