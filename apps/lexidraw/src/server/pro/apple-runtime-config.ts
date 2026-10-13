import {
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { z } from "zod";
import { createPrivateKey } from "node:crypto";
// Apple PKI Root CA G3, SHA-256 63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179.
const APPLE_ROOT = Buffer.from(
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==",
  "base64",
);
export const APPLE_BUNDLE = "xyz.raiju.lexidraw";
export const APPLE_PRODUCT = "xyz.raiju.lexidraw.pro.monthly";
export function productionAppleVerifier() {
  return new SignedDataVerifier(
    [APPLE_ROOT],
    true,
    Environment.SANDBOX,
    APPLE_BUNDLE,
  );
}
const Config = z.object({
  APPLE_SANDBOX_ENABLED: z.literal("true"),
  APPLE_SANDBOX_KEY: z.string().min(1),
  APPLE_SANDBOX_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/),
  APPLE_SANDBOX_ISSUER_ID: z.uuid(),
  APPLE_SANDBOX_SUBSCRIPTION_GROUP_ID: z.string().regex(/^\d{1,80}$/),
});
export function appleSandboxConfig(
  environment: Record<string, string | undefined>,
) {
  const config = Config.safeParse(environment);
  if (!config.success) return null;
  try {
    const key = createPrivateKey(config.data.APPLE_SANDBOX_KEY);
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return null;
    return config.data;
  } catch {
    return null;
  }
}
