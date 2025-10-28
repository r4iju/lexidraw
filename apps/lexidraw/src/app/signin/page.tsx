import { Suspense } from "react";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import FormSkeleton from "./skeleton";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import SignInForm from "./form";
import type { ServerRuntime } from "next";

export const runtime: ServerRuntime = "edge";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: { callbackUrl?: string };
}) {
  const session = await auth();
  if (session) {
    const h = await headers();
    const referer = h.get("referer");
    try {
      const baseOrigin = (() => {
        try {
          return new URL(process.env.NEXTAUTH_URL || "http://localhost").origin;
        } catch {
          return "";
        }
      })();

      // Prefer explicit callbackUrl param if provided and same-origin
      const candidate = searchParams?.callbackUrl || referer || "";
      const url = new URL(candidate, baseOrigin || undefined);
      const sameOrigin = url.origin === new URL(process.env.NEXTAUTH_URL!).origin;
      const disallowed = ["/signin", "/signup", "/signout", "/error"];
      const dest = sameOrigin ? `${url.pathname}${url.search}${url.hash}` : null;
      if (dest && !disallowed.some((p) => dest.startsWith(p))) return redirect(dest);
    } catch {}
    return redirect("/dashboard");
  }

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
