import { Card } from "~/components/ui/card";
import { Suspense } from "react";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import SignInForm from "./form";
import type { ServerRuntime } from "next";

export default async function SignInPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[calc(100vh-56px-65px)] flex-col items-center justify-center "
    >
      <Card className="w-full p-6 md:max-w-lg">
        <h2 className="mb-4 text-center text-title font-semibold text-foreground">
          Sign in
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <SignInForm />
        </Suspense>
      </Card>
      <Button asChild variant="link">
        <Link href="/signup">No account? Sign up here</Link>
      </Button>
    </main>
  );
}
