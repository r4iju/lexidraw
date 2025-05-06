import { Suspense } from "react";
import ProfileForm from "./form";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
import type { ServerRuntime } from "next";

export const dynamic = "force-dynamic";
export const runtime: ServerRuntime = "edge";

export default async function SignInPage() {
  const user = await api.auth.getProfile.query();

  return (
    <main className=" flex h-full min-h-[calc(100vh-56px-65px)] flex-col items-center justify-center">
      <div className="w-full rounded  border border-border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
          Edit profile
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <ProfileForm user={user} />
        </Suspense>
      </div>
      <Button asChild variant="link">
        <Link href="/dashboard">Go to my drawings</Link>
      </Button>
    </main>
  );
}
