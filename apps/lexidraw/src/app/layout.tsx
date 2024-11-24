import "~/styles/globals.css";

import { Fredoka, Inter, Anonymous_Pro } from "next/font/google";
import { Toaster } from "~/components/ui/toaster";
import { TRPCReactProvider } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = Anonymous_Pro({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-mono",
});

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

export const metadata = {
  title: "Lexidraw",
  description: "An Excalidraw demo app",
};

type Props = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "flex min-h-screen flex-col font-fredoka bg-background antialiased p-0",
          fredoka.variable,
          inter.variable,
          mono.variable,
        )}
      >
        <SessionProvider>
          <TRPCReactProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {" "}
              <div className="flex h-screen flex-col bg-background">
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
              </div>
            </ThemeProvider>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
