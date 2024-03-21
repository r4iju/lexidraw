import Link from "next/link";
import { Button } from "~/components/ui/button";

export const runtime = "edge";

export default function AuthError() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full rounded  border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Error
        </h2>
        <p className="mb-6 text-center text-gray-900 dark:text-white">
          Something went wrong
        </p>

        <div className="flex flex-col gap-4 ">
          <Button asChild className="w-full">
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button asChild className="w-full">
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
