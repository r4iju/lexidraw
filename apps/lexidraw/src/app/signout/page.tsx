import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { AuthCard } from "~/components/auth-card";
import SignOutForm from "./form";
import FormSkeleton from "./skeleton";

export default async function SignOutPage() {
  const session = await auth();
  if (!session) {
    return redirect("/signin");
  }

  return (
    <AuthCard
      title="Sign out of Lexidraw?"
      description="You’ll need to sign in again to open your files."
    >
      <Suspense fallback={<FormSkeleton />}>
        <SignOutForm />
      </Suspense>
    </AuthCard>
  );
}
