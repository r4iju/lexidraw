import { Card } from "~/components/ui/card";
import { Suspense } from "react";
import SignOutForm from "./form";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { ServerRuntime } from "next";

export default async function SignInPage() {
  const session = await auth();
  if (!session) {
    return redirect("/signin");
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className=" flex h-full min-h-[calc(100vh-56px-65px)] flex-col items-center justify-center "
    >
      <Card className="flex w-full flex-col gap-y-6 p-6 md:max-w-lg">
        <h2 className="text-center text-title font-semibold text-foreground">
          Sign Out
        </h2>
        <span className="text-center  text-muted-foreground">
          Are you sure you want to sign out?
        </span>
        <Suspense fallback={<FormSkeleton />}>
          <SignOutForm />
        </Suspense>
      </Card>
      <Button asChild variant="link">
        <Link href="/dashboard">Go to my drawings</Link>
      </Button>
    </main>
  );
}
