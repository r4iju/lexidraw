import { z } from "zod";
export const SandboxConfigSchema = z.object({
  key: z.string().regex(/^sk_test_[A-Za-z0-9_]+$/),
  webhookSecret: z.string().startsWith("whsec_"),
  priceId: z.string().startsWith("price_"),
  productId: z.string().startsWith("prod_"),
  portalConfigurationId: z.string().startsWith("bpc_"),
  origin: z.string().refine((value) => {
    try {
      const origin = new URL(value);
      return (
        origin.origin === value &&
        !origin.username &&
        !origin.password &&
        (origin.protocol === "https:" ||
          (origin.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(origin.hostname)))
      );
    } catch {
      return false;
    }
  }),
});
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
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
  const parsed = SandboxConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
}
