import { Card } from "~/components/ui/card";
import { Suspense } from "react";
import SignUpForm from "./form";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { ServerRuntime } from "next";

export default async function SignInPage() {
  const session = await auth();
  if (session) {
    return redirect("/dashboard");
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[calc(100vh-56px-65px)] flex-col items-center justify-center "
    >
      <Card className="w-full p-6 md:max-w-lg">
        <h2 className="mb-4 text-center text-title font-semibold text-foreground">
          Sign up
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <SignUpForm />
        </Suspense>
      </Card>

      <Button asChild variant="link">
        <Link href="/signin">Already registered? Sign in here</Link>
      </Button>
    </main>
  );
}
