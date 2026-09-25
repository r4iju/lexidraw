import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "~/components/auth-card";
import { Button } from "~/components/ui/button";

/**
 * The codes Auth.js sends to the sign-in and error pages, in words. Anything
 * else, including a code made up in the address bar, gets the fallback and is
 * never echoed.
 */
const REASONS: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email already has an account that signs in with a password. Sign in with your email and password instead.",
  AccountNotLinked:
    "This email already has an account that signs in with a password. Sign in with your email and password instead.",
  AccessDenied:
    "GitHub didn’t let Lexidraw use your account, or the sign-in was cancelled.",
  OAuthCallbackError: "GitHub couldn’t finish signing you in.",
  OAuthSignin: "We couldn’t start signing you in with GitHub.",
  OAuthSignInError: "We couldn’t start signing you in with GitHub.",
  CredentialsSignin:
    "That email and password don’t match. Try again or use GitHub.",
  Verification: "The sign-in link expired or was already used.",
  MissingCSRF: "The sign-in form expired before it was sent.",
  Configuration:
    "Something is wrong on our side, not with your account. Try again in a few minutes.",
};

const FALLBACK = "Something went wrong while signing you in.";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

async function Reason({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    (typeof error === "string" && Object.hasOwn(REASONS, error)
      ? REASONS[error]
      : undefined) ?? FALLBACK
  );
}

export default function SignInErrorPage({ searchParams }: Props) {
  return (
    <AuthCard
      title="We couldn’t sign you in"
      description={
        <Suspense fallback={<span className="invisible">{FALLBACK}</span>}>
          <Reason searchParams={searchParams} />
        </Suspense>
      }
    >
      <div className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <Link href="/signin">Try again</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/dashboard">Back to Home</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
