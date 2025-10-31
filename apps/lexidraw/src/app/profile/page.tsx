import { Suspense } from "react";
import ProfileForm from "./form";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
import type { ServerRuntime } from "next";
import { Card } from "~/components/ui/card";

export const dynamic = "force-dynamic";
export const runtime: ServerRuntime = "nodejs";

export default async function SignInPage() {
  const user = await api.auth.getProfile.query();

  return (
    <main className="flex h-full min-h-[calc(100vh-56px-65px)] flex-col w-full">
      <div className="flex-1 overflow-y-auto w-full">
        <div className="flex justify-center p-4 min-h-full">
          <Card className="w-full max-w-xl">
            <div className="p-6">
              <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
                Edit profile
              </h2>
              <Suspense fallback={<FormSkeleton />}>
                <ProfileForm user={user} />
              </Suspense>
            </div>
          </Card>
        </div>
      </div>
      <div className="flex justify-center p-4">
        <Button asChild variant="link">
          <Link href="/dashboard">Go to my drawings</Link>
        </Button>
      </div>
    </main>
  );
}
