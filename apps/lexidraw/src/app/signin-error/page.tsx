import { Card } from "~/components/ui/card";
import type { ServerRuntime } from "next";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export default function AuthError() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex h-full items-center justify-center"
    >
      <Card className="w-full p-6 md:max-w-lg">
        <h2 className="mb-4 text-center text-title font-semibold text-foreground">
          Error
        </h2>
        <p className="mb-6 text-center text-foreground">Something went wrong</p>

        <div className="flex flex-col gap-4 ">
          <Button asChild className="w-full">
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button asChild className="w-full">
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
