// Synthetic test CA only. Production never imports this module or accepts its root.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign, X509Certificate } from "node:crypto";
import {
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
const dir = mkdtempSync(join(tmpdir(), "apple-test-ca-"));
const openssl = (...args: string[]) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
for (const name of ["root", "intermediate", "leaf"])
  openssl(
    "ecparam",
    "-name",
    "prime256v1",
    "-genkey",
    "-noout",
    "-out",
    `${name}.key`,
  );
openssl(
  "req",
  "-new",
  "-x509",
  "-key",
  "root.key",
  "-out",
  "root.pem",
  "-days",
  "2",
  "-subj",
  "/CN=Lexidraw TEST ONLY Root",
  "-addext",
  "basicConstraints=critical,CA:TRUE",
);
for (const [name, issuer, extension] of [
  [
    "intermediate",
    "root",
    "basicConstraints=critical,CA:TRUE\n1.2.840.113635.100.6.2.1=DER:05:00",
  ],
  [
    "leaf",
    "intermediate",
    "basicConstraints=critical,CA:FALSE\n1.2.840.113635.100.6.11.1=DER:05:00",
  ],
]) {
  writeFileSync(join(dir, `${name}.ext`), extension ?? "");
  openssl(
    "req",
    "-new",
    "-key",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=Lexidraw TEST ONLY ${name}`,
  );
  openssl(
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${issuer}.pem`,
    "-CAkey",
    `${issuer}.key`,
    "-CAcreateserial",
    "-out",
    `${name}.pem`,
    "-days",
    "2",
    "-extfile",
    `${name}.ext`,
  );
}
const key = readFileSync(join(dir, "leaf.key"));
const certs = ["leaf", "intermediate", "root"].map(
  (name) => new X509Certificate(readFileSync(join(dir, `${name}.pem`))).raw,
);
const root = new X509Certificate(readFileSync(join(dir, "root.pem"))).raw;
rmSync(dir, { recursive: true });
export function appleFixture(now: number) {
  const config = {
    bundleId: "xyz.raiju.lexidraw",
    productId: "xyz.raiju.lexidraw.pro.monthly",
    subscriptionGroupId: "123456",
  };
  const signPayload = (body: object) => {
    const header = Buffer.from(
      JSON.stringify({
        alg: "ES256",
        x5c: certs.map((cert) => cert.toString("base64")),
      }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const transaction = {
    transactionId: "10001",
    originalTransactionId: "10001",
    bundleId: config.bundleId,
    productId: config.productId,
    subscriptionGroupIdentifier: config.subscriptionGroupId,
    appAccountToken: "",
    environment: "Sandbox",
    type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED",
    quantity: 1,
    purchaseDate: now,
    expiresDate: now + 300000,
    signedDate: now,
    revocationDate: undefined as number | undefined,
  };
  const renewal = {
    environment: "Sandbox",
    originalTransactionId: "10001",
    productId: config.productId,
    autoRenewProductId: config.productId,
    autoRenewStatus: 1,
    isInBillingRetryPeriod: false,
    signedDate: now,
  };
  const state = { status: 1 };
  const api = {
    getTransactionInfo: async (_id: string) => ({
      signedTransactionInfo: signPayload(transaction),
    }),
    getAllSubscriptionStatuses: async (_id: string) => ({
      environment: "Sandbox",
      bundleId: config.bundleId,
      data: [
        {
          subscriptionGroupIdentifier: config.subscriptionGroupId,
          lastTransactions: [
            {
              originalTransactionId: transaction.originalTransactionId,
              status: state.status,
              signedTransactionInfo: signPayload(transaction),
              signedRenewalInfo: signPayload(renewal),
            },
          ],
        },
      ],
    }),
  };
  return {
    config,
    verifier: new SignedDataVerifier(
      [root],
      false,
      Environment.SANDBOX,
      config.bundleId,
    ),
    transaction,
    renewal,
    state,
    api,
    sign: signPayload,
  };
}
