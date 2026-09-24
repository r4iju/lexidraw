import "~/styles/globals.css";

import { Fredoka } from "next/font/google";
import { Ubuntu_Mono } from "next/font/google";
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
import LayoutListener from "./layout-listener";
import LeaveGuardListener from "./leave-guard-listener";
import ImpersonationBanner from "~/components/admin/impersonation-banner";
import TRPCProviderWrapper from "./trpc-provider-wrapper";
import { DashboardCacheInvalidator } from "~/components/dashboard-cache-invalidator";

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

const mono = Ubuntu_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Lexidraw",
  description: "An Excalidraw demo app",
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
          fredoka.variable,
          mono.variable,
        )}
        style={{ scrollbarGutter: "stable", scrollbarWidth: "thin" }}
      >
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 focus:translate-y-0 rounded-md bg-primary text-primary-foreground p-3 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <LeaveGuardListener />
        <SessionProvider>
          <Suspense fallback={<div className="min-h-[100vh]" />}>
            <TRPCProviderWrapper>
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
              >
                <TooltipProvider>
                  {children}
                  <ImpersonationBanner />
                  <Toaster />
                  <LayoutListener />
                  <DashboardCacheInvalidator />
                  <Analytics />
                </TooltipProvider>
              </ThemeProvider>
            </TRPCProviderWrapper>
          </Suspense>
        </SessionProvider>
      </body>
    </html>
  );
}
