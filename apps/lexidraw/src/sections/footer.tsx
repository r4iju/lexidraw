import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";

async function FooterContent() {
  // Access headers first to satisfy Next.js 16 requirement before using new Date()
  await headers();

  return (
    <footer className="flex w-full shrink-0 min-h-[var(--footer-height)] flex-col items-center gap-2 border-t border-border px-4 py-[var(--footer-py)] sm:flex-row md:px-6">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        © {new Date().getFullYear()} An Lexidraw. All rights reserved.
      </p>
      <nav className="flex gap-4 sm:ml-auto sm:gap-6">
        <Link
          className="text-xs underline-offset-4 hover:underline"
          href="/terms-of-service"
        >
          Terms of Service
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

export default function Footer() {
  return (
    <Suspense
      fallback={
        <footer className="flex w-full shrink-0 min-h-[var(--footer-height)] flex-col items-center gap-2 border-t border-border px-4 py-[var(--footer-py)] sm:flex-row md:px-6">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            © Lexidraw. All rights reserved.
          </p>
          <nav className="flex gap-4 sm:ml-auto sm:gap-6">
            <Link
              className="text-xs underline-offset-4 hover:underline"
              href="/terms-of-service"
            >
              Terms of Service
            </Link>
            <Link
              className="text-xs underline-offset-4 hover:underline"
              href="/privacy-policy"
            >
              Privacy
            </Link>
          </nav>
        </footer>
      }
    >
      <FooterContent />
    </Suspense>
  );
}
