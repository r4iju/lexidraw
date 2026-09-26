import Apple, { type AppleProfile } from "next-auth/providers/apple";
import { z } from "zod";

/** What Lexidraw signs in to Apple with, from the Apple Developer account. */
export type AppleCredentials = {
  /** The Services ID, which Apple calls the client ID. */
  servicesId: string;
  teamId: string;
  /** The ID of the Sign in with Apple key. */
  keyId: string;
  /** That key, as the PKCS #8 PEM Apple hands out, newlines escaped or not. */
  privateKey: string;
};

/** The credentials when every one is set, which is when the button shows. */
export function appleCredentials(env: {
  AUTH_APPLE_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
}): AppleCredentials | null {
  const { AUTH_APPLE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env;
  if (!AUTH_APPLE_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    return null;
  }
  return {
    servicesId: AUTH_APPLE_ID,
    teamId: APPLE_TEAM_ID,
    keyId: APPLE_KEY_ID,
    privateKey: APPLE_PRIVATE_KEY,
  };
}

/**
 * Apple takes a client secret only as a JWT signed with the key, and refuses
 * one that lives past six months. Signing it here, fresh for each hour, means
 * there is no secret to rotate by hand.
 */
const SECRET_LIFETIME_S = 60 * 60;
const RENEW_BEFORE_S = 5 * 60;

const secrets = new WeakMap<
  AppleCredentials,
  { value: Promise<string>; expiresAt: number }
>();

export function appleClientSecret(
  credentials: AppleCredentials,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const cached = secrets.get(credentials);
  if (cached && cached.expiresAt - RENEW_BEFORE_S > now) return cached.value;
  const expiresAt = now + SECRET_LIFETIME_S;
  const value = signClientSecret(credentials, now, expiresAt);
  secrets.set(credentials, { value, expiresAt });
  value.catch(() => secrets.delete(credentials));
  return value;
}

async function signClientSecret(
  { servicesId, teamId, keyId, privateKey }: AppleCredentials,
  issuedAt: number,
  expiresAt: number,
) {
  const der = Buffer.from(
    privateKey
      .replaceAll("\\n", "\n")
      .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
      .replace(/\s/g, ""),
    "base64",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encode = (part: object) =>
    Buffer.from(JSON.stringify(part)).toString("base64url");
  const signingInput = `${encode({ alg: "ES256", kid: keyId })}.${encode({
    iss: teamId,
    iat: issuedAt,
    exp: expiresAt,
    aud: "https://appleid.apple.com",
    sub: servicesId,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

/** Apple posts the name, once, as the `user` form field. */
const FirstConsent = z.object({
  name: z
    .object({
      firstName: z.string().nullish(),
      lastName: z.string().nullish(),
    })
    .nullish(),
});

export async function appleProvider(credentials: AppleCredentials) {
  return Apple({
    clientId: credentials.servicesId,
    clientSecret: await appleClientSecret(credentials),
    profile(profile: AppleProfile) {
      const { data } = FirstConsent.safeParse(profile.user);
      const name = data?.name;
      const fullName = [name?.firstName, name?.lastName]
        .filter(Boolean)
        .join(" ");
      return {
        id: profile.sub,
        name: fullName || profile.email,
        email: profile.email,
        image: null,
      };
    },
  });
}
