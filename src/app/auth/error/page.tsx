import Link from "next/link";
import { Button } from "~/components/ui/button";

export default function AuthError() {
  return (
    <div className="flex min-h-[90vh] items-center justify-center">
      <div className="w-full rounded  border p-6 shadow-lg md:max-w-lg">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-white">
          Error
        </h2>
        <p className="mb-6 text-center text-gray-900 dark:text-white">
          Something went wrong
        </p>

        <div className="flex flex-col gap-4 ">
          <Link href="/signin">
            <Button className="w-full">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button className="w-full">Sign up</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
