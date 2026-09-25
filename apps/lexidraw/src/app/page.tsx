import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { SITE_PREVIEW } from "~/lib/link-preview";
import { MarketingFrame } from "~/sections/marketing-frame";
import { LandingFeatures } from "./landing-features";
import { auth } from "~/server/auth";

export const metadata: Metadata = {
  title: { absolute: "Lexidraw" },
  ...SITE_PREVIEW,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

/** Open for someone signed in; sign up or sign in for a visitor. */
async function CallToAction() {
  const session = await auth();
  return session?.user ? (
    <Button asChild size="lg">
      <Link href="/dashboard">Open Lexidraw</Link>
    </Button>
  ) : (
    <div className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-3">
      <Button asChild size="lg">
        <Link href="/signup">Get started, free</Link>
      </Button>
      <Link
        href="/signin"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Sign in
      </Link>
    </div>
  );
}

export default function LandingPage() {
  return (
    <MarketingFrame>
      <main id="main-content" tabIndex={-1} className="flex flex-col">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pb-12 pt-16 text-center sm:px-6 md:pb-20 md:pt-24">
          <h1 className="font-brand text-4xl text-balance sm:text-5xl md:text-6xl">
            Write documents and sketch diagrams in one place.
          </h1>
          <p className="max-w-xl text-lg text-balance text-muted-foreground md:text-xl">
            Rich text, slides and hand-drawn diagrams, shared with a link. Saved
            as you go.
          </p>
          <Suspense fallback={<div aria-hidden="true" className="h-11" />}>
            <CallToAction />
          </Suspense>
        </section>

        <LandingFeatures />
      </main>
    </MarketingFrame>
  );
}
