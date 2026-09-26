/** The ways to sign in besides a password, in the order they are offered. */
export const SIGN_IN_PROVIDERS = ["apple", "github"] as const;

export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];
