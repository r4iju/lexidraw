import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { AuthCard } from "~/components/auth-card";
import SignUpForm from "./form";
import FormSkeleton from "./skeleton";

export default async function SignUpPage() {
  const session = await auth();
  if (session) {
    return redirect("/dashboard");
  }

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
      <Suspense fallback={<FormSkeleton />}>
        <SignUpForm />
      </Suspense>
    </AuthCard>
  );
}
