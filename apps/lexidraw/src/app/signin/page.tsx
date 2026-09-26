import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "~/components/auth-card";
import { offeredProviders } from "~/server/auth";
import FormSkeleton from "./skeleton";
import SignInForm from "./form";
import { callbackPath } from "./callback-path";

type Props = {
  searchParams: Promise<{
    error?: string | string[];
    callbackUrl?: string | string[];
  }>;
};

/**
 * A provider sign-in that fails comes back here with a code; the
 * error page is the one that explains it.
 */
async function RedirectFailedSignIn({ searchParams }: Props) {
  const { error } = await searchParams;
  if (typeof error === "string") {
    redirect(`/signin-error?${new URLSearchParams({ error })}`);
  }
  return null;
}

/** Sends the user back to the page that asked them to sign in. */
async function SignInFormReturning({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  return (
    <SignInForm
      callbackPath={callbackPath(callbackUrl)}
      providers={offeredProviders}
    />
  );
}

export default function SignInPage({ searchParams }: Props) {
  return (
    <AuthCard
      title="Sign in"
      after={
        <>
          New to Lexidraw?{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/signup"
          >
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <RedirectFailedSignIn searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<FormSkeleton />}>
        <SignInFormReturning searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
