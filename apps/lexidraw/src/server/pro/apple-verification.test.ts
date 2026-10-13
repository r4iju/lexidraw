import { expect, test } from "bun:test";
import {
  appleSandboxConfig,
  productionAppleVerifier,
} from "./apple-runtime-config";
import { appleFixture } from "./apple-test-fixture";
test("production trust rejects an otherwise valid signature from the isolated test CA, wrong sandbox environment and tampered signature", async () => {
  const f = appleFixture(Date.now());
  f.transaction.appAccountToken = crypto.randomUUID();
  const valid = f.sign(f.transaction);
  expect(
    (await f.verifier.verifyAndDecodeTransaction(valid)).transactionId,
  ).toBe("10001");
  await expect(
    productionAppleVerifier().verifyAndDecodeTransaction(valid),
  ).rejects.toThrow();
  for (const environment of ["Production", "Xcode", "LocalTesting"])
    await expect(
      f.verifier.verifyAndDecodeTransaction(
        f.sign({ ...f.transaction, environment }),
      ),
    ).rejects.toThrow();
  const parts = valid.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ ...f.transaction, transactionId: "99999" }),
  ).toString("base64url");
  await expect(
    f.verifier.verifyAndDecodeTransaction(parts.join(".")),
  ).rejects.toThrow();
  await expect(
    f.verifier.verifyAndDecodeTransaction(
      f.sign({ ...f.transaction, bundleId: "stolen.bundle" }),
    ),
  ).rejects.toThrow();
});

test("unsupported or incomplete Apple API key configuration keeps the pre-purchase server gate unavailable", () => {
  expect(
    appleSandboxConfig({
      APPLE_SANDBOX_ENABLED: "true",
      APPLE_SANDBOX_KEY: "not-a-P256-private-key",
      APPLE_SANDBOX_KEY_ID: "ABCDEFGHIJ",
      APPLE_SANDBOX_ISSUER_ID: "11111111-1111-4111-8111-111111111111",
      APPLE_SANDBOX_SUBSCRIPTION_GROUP_ID: "123456",
    }),
  ).toBeNull();
  expect(
    appleSandboxConfig({
      APPLE_KEY: "live-or-generic-key",
      APPLE_SANDBOX_ENABLED: "true",
    }),
  ).toBeNull();
});
