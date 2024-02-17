import { Suspense } from "react";
import ProfileForm from "./form";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";

export default async function SignInPage() {
  const user = await api.auth.getProfile.query();

  return (
    <div className=" flex min-h-[90vh] flex-col items-center justify-center ">
      <div className="w-full rounded  border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Edit profile
        </h2>
        <Suspense fallback={<FormSkeleton />}>
          <ProfileForm user={user} />
        </Suspense>
      </div>
      <Link href="/dashboard">
        <Button variant="link">Go to my drawings</Button>
      </Link>
    </div>
  );
}
