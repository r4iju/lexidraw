import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { AuthCard } from "~/components/auth-card";
import SignUpForm from "./form";
import FormSkeleton from "./skeleton";

async function RedirectSignedIn() {
  if (await auth()) redirect("/dashboard");
  return null;
}

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      after={
        <>
          Have an account?{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/signin"
          >
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <RedirectSignedIn />
      </Suspense>
      <Suspense fallback={<FormSkeleton />}>
        <SignUpForm />
      </Suspense>
    </AuthCard>
  );
}
