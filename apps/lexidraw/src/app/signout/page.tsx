import { Suspense } from "react";
import SignOutForm from "./form";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { ServerRuntime } from "next";

export const dynamic = "force-dynamic";
export const runtime: ServerRuntime = "edge";

export default async function SignInPage() {
  const session = await auth();
  if (!session) {
    return redirect("/signin");
  }

  return (
    <main className=" flex h-full flex-col items-center justify-center ">
      <div className="flex w-full flex-col gap-y-6  rounded border p-6 shadow-lg md:max-w-lg">
        <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
          Sign Out
        </h2>
        <span className="text-center  text-gray-600 dark:text-gray-300">
          Are you sure you want to sign out?
        </span>
        <Suspense fallback={<FormSkeleton />}>
          <SignOutForm />
        </Suspense>
      </div>
      <Button asChild variant="link">
        <Link href="/dashboard">Go to my drawings</Link>
      </Button>
    </main>
  );
}
