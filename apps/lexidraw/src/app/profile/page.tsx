import { Suspense } from "react";
import ProfileForm from "./form";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
import { Card } from "~/components/ui/card";

async function ProfileContent() {
  const user = await api.auth.getProfile.query();
  return (
    <Card className="w-full max-w-xl">
      <div className="p-6">
        <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
          Edit profile
        </h2>
        <ProfileForm user={user} />
      </div>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <main className="flex h-full min-h-[calc(100vh-56px-65px)] flex-col w-full">
      <div className="flex-1 overflow-y-auto w-full">
        <div className="flex flex-col gap-4 items-center justify-center p-4">
          <Suspense
            fallback={
              <Card className="w-full max-w-xl">
                <div className="p-6">
                  <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
                    Edit profile
                  </h2>
                  <FormSkeleton />
                </div>
              </Card>
            }
          >
            <ProfileContent />
          </Suspense>
          <Button asChild variant="link">
            <Link href="/dashboard">Go to my drawings</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
