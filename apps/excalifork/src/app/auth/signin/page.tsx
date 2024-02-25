import { Suspense } from "react";
import SignInForm from "./form";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export default async function SignInPage() {
  const session = await auth();
  if (session) {
    return redirect("/dashboard");
  }

  return (
    <div className=" flex min-h-[90vh] flex-col items-center justify-center ">
      <div className="w-full rounded  border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Sign in
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <SignInForm />
        </Suspense>
      </div>
      <Link href="/auth/signup">
        <Button variant="link">No account? Sign up here</Button>
      </Link>
    </div>
  );
}