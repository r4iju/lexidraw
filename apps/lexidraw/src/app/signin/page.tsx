import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "~/components/auth-card";
import FormSkeleton from "./skeleton";
import SignInForm from "./form";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

/**
 * A GitHub sign-in that fails comes back here with a code; the error page is
 * the one that explains it.
 */
async function RedirectFailedSignIn({ searchParams }: Props) {
  const { error } = await searchParams;
  if (typeof error === "string") {
    redirect(`/signin-error?${new URLSearchParams({ error })}`);
  }
  return null;
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
        <SignInForm />
      </Suspense>
    </AuthCard>
  );
}
