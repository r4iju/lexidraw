import { Suspense } from "react";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import SignInForm from "./form";
import type { ServerRuntime } from "next";

export const runtime: ServerRuntime = "edge";

export default async function SignInPage() {
  return (
    <main className="flex min-h-[calc(100vh-56px-65px)] flex-col items-center justify-center ">
      <div className="w-full rounded  border border-border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
          Sign in
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <SignInForm />
        </Suspense>
      </div>
      <Button asChild variant="link">
        <Link href="/signup">No account? Sign up here</Link>
      </Button>
    </main>
  );
}
