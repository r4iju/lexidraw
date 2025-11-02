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
import ImpersonationBanner from "~/components/admin/impersonation-banner";
import TRPCProviderWrapper from "./trpc-provider-wrapper";

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
          "h-[var(--dynamic-viewport-height)] max-w-[100dvw] flex flex-col font-fredoka bg-background text-foreground antialiased overflow-y-hidden",
          fredoka.variable,
          mono.variable,
        )}
        style={{ scrollbarGutter: "stable", scrollbarWidth: "thin" }}
      >
        <SessionProvider>
          <Suspense fallback={children}>
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
