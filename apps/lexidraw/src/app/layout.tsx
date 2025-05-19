import "~/styles/globals.css";

import { Fredoka } from "next/font/google";
import { headers as nextHeaders } from "next/headers";
import { Analytics } from "@vercel/analytics/react";
import { TRPCReactProvider } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Toaster } from "~/components/ui/sonner";
import Script from "next/script";
import env from "@packages/env";
import type { Metadata } from "next";
import LayoutListener from "./layout-listener";

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

export const metadata = {
  title: "Lexidraw",
  description: "An Excalidraw demo app",
  viewport: {
    width: "device-width",
    initialScale: 1,
    interactiveWidget: "resizes-content",
    userScalable: true,
  },
} satisfies Metadata;

type Props = {
  children: React.ReactNode;
};

export default async function RootLayout({ children }: Props) {
  const headersList = await nextHeaders();
  const plainHeaders = new Map(headersList.entries());

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
        )}
        style={{ scrollbarGutter: "stable", scrollbarWidth: "thin" }}
      >
        <SessionProvider>
          <TRPCReactProvider headers={plainHeaders}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <TooltipProvider>
                {children}
                <Toaster />
                <LayoutListener />
                <Analytics />
              </TooltipProvider>
            </ThemeProvider>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
