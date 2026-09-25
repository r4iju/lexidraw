import "~/styles/globals.css";

import { fontVariables } from "~/lib/fonts";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { cn } from "~/lib/utils";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Toaster } from "~/components/ui/sonner";
import Script from "next/script";
import env from "@packages/env";
import type { Metadata, Viewport } from "next";
import { SITE_PREVIEW } from "~/lib/link-preview";
import LayoutListener from "./layout-listener";
import LeaveGuardListener from "./leave-guard-listener";
import ImpersonationBanner from "~/components/admin/impersonation-banner";
import TRPCProviderWrapper from "./trpc-provider-wrapper";
import { DashboardCacheInvalidator } from "~/components/dashboard-cache-invalidator";
import { APP_NAME, TITLE_TEMPLATE } from "~/lib/tab-title";

export const metadata = {
  title: { default: APP_NAME, template: TITLE_TEMPLATE },
  ...SITE_PREVIEW,
} satisfies Metadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.985 0.002 285)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.17 0.006 285)" },
  ],
};

type Props = {
  children: React.ReactNode;
};

export default async function RootLayout({ children }: Props) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {env.REACT_SCAN_ENABLED && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-scan/dist/auto.global.js"
          />
        )}
      </head>
      <body
        className={cn(
          "h-[var(--dynamic-viewport-height)] max-w-[100dvw] flex flex-col font-sans bg-background text-foreground antialiased overflow-y-hidden",
          fontVariables,
        )}
        style={{ scrollbarGutter: "stable", scrollbarWidth: "thin" }}
      >
        <a
          href="#main-content"
          className="print:hidden fixed left-4 top-4 z-[100] -translate-y-24 focus:translate-y-0 rounded-md bg-primary text-primary-foreground p-3 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <LeaveGuardListener />
        <SessionProvider>
          <TRPCProviderWrapper>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <TooltipProvider>
                {children}
                <Suspense fallback={null}>
                  <ImpersonationBanner />
                </Suspense>
                <Toaster />
                <LayoutListener />
                <Suspense fallback={null}>
                  <DashboardCacheInvalidator />
                </Suspense>
                <Analytics />
              </TooltipProvider>
            </ThemeProvider>
          </TRPCProviderWrapper>
        </SessionProvider>
      </body>
    </html>
  );
}
