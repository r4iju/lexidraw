import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

function FooterBody({ year }: { year?: number }) {
  return (
    <footer className="mt-auto flex w-full shrink-0 flex-col items-center gap-2 border-t border-border px-4 py-[var(--footer-py)] sm:flex-row sm:items-baseline md:px-6">
      <p className="text-xs text-muted-foreground">
        © {year ? `${year} ` : ""}Lexidraw
      </p>
      <nav
        aria-label="Legal"
        className="flex items-baseline gap-4 sm:ml-auto sm:gap-6"
      >
        <Link
          className="text-xs underline-offset-4 hover:underline"
          href="/terms-of-service"
        >
          Terms
        </Link>
        <Link
          className="text-xs underline-offset-4 hover:underline"
          href="/privacy-policy"
        >
          Privacy
        </Link>
      </nav>
    </footer>
  );
}

async function FooterWithYear() {
  // A dynamic API first: the year is read per request, not baked into a build.
  await headers();
  return <FooterBody year={new Date().getFullYear()} />;
}

export default function Footer() {
  return (
    <Suspense fallback={<FooterBody />}>
      <FooterWithYear />
    </Suspense>
  );
}
