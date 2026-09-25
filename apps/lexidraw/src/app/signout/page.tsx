import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { AuthCard } from "~/components/auth-card";
import SignOutForm from "./form";
import FormSkeleton from "./skeleton";

async function RedirectSignedOut() {
  if (!(await auth())) redirect("/signin");
  return null;
}

export default function SignOutPage() {
  return (
    <AuthCard
      title="Sign out of Lexidraw?"
      description="You’ll need to sign in again to open your files."
    >
      <Suspense fallback={null}>
        <RedirectSignedOut />
      </Suspense>
      <Suspense fallback={<FormSkeleton />}>
        <SignOutForm />
      </Suspense>
    </AuthCard>
  );
}
