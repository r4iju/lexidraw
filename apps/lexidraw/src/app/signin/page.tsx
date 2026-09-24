import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "~/components/auth-card";
import FormSkeleton from "./skeleton";
import SignInForm from "./form";

type Props = { searchParams: Promise<{ error?: string | string[] }> };

export default async function SignInPage({ searchParams }: Props) {
  // A GitHub sign-in that fails comes back here with a code; the error page
  // is the one that explains it.
  const { error } = await searchParams;
  if (typeof error === "string") {
    redirect(`/signin-error?${new URLSearchParams({ error })}`);
  }

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
      <Suspense fallback={<FormSkeleton />}>
        <SignInForm />
      </Suspense>
    </AuthCard>
  );
}
