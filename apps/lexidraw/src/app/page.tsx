import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { SITE_PREVIEW } from "~/lib/link-preview";
import { cn } from "~/lib/utils";
import { MarketingFrame } from "~/sections/marketing-frame";
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

const FEATURES = [
  {
    title: "Docs that do more",
    benefit: "Headings, tables, embeds and slides, all in one page.",
    image: "document",
    dark: true,
    alt: "A Lexidraw document titled Launch plan, with a list of goals and a timeline table of weekly milestones and owners.",
  },
  {
    title: "Sketch it out",
    benefit: "Hand-drawn diagrams and wireframes on an open canvas.",
    image: "drawing",
    dark: false,
    alt: "A hand-drawn sign-up flow in Lexidraw: landing page, sign up and a verified check, leading to Home or to resending the link.",
  },
  {
    title: "Find it again",
    benefit: "Folders, favorites and search through every word you wrote.",
    image: "home",
    dark: true,
    alt: "Lexidraw's Home showing a Product launch folder, with previews of its documents, drawings and a subfolder.",
  },
] as const;

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

        <section
          aria-label="What you can do"
          className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-20 sm:px-6 md:gap-24 md:pb-28 lg:px-8"
        >
          {FEATURES.map((feature, index) => (
            <figure
              key={feature.image}
              className="grid items-center gap-6 md:grid-cols-12 md:gap-10"
            >
              <div
                className={cn(
                  "relative aspect-8/5 overflow-hidden rounded-xl border border-border bg-card shadow-sm md:col-span-8",
                  index % 2 === 1 && "md:order-last",
                )}
              >
                <Image
                  src={`/images/landing/${feature.image}-light.webp`}
                  alt={feature.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, 66vw"
                  className={cn(
                    "object-cover object-top-left",
                    feature.dark && "dark:hidden",
                  )}
                />
                {feature.dark && (
                  <Image
                    src={`/images/landing/${feature.image}-dark.webp`}
                    alt={feature.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 66vw"
                    className="hidden object-cover object-top-left dark:block"
                  />
                )}
              </div>
              <figcaption className="flex flex-col gap-2 md:col-span-4">
                <h2 className="font-brand text-2xl md:text-3xl">
                  {feature.title}
                </h2>
                <p className="text-lg text-muted-foreground">
                  {feature.benefit}
                </p>
              </figcaption>
            </figure>
          ))}
        </section>
      </main>
    </MarketingFrame>
  );
}
