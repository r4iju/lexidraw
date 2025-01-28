import "~/styles/globals.css";

import {
  Noto_Sans_JP,
  Fredoka,
  Inter,
  Anonymous_Pro,
  M_PLUS_Rounded_1c,
} from "next/font/google";
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

const mplus = M_PLUS_Rounded_1c({
  weight: ["400", "700"],
  subsets: [
    "latin",
    "latin-ext",
    "cyrillic",
    "cyrillic-ext",
    "greek",
    "greek-ext",
    "hebrew",
    "vietnamese",
  ],
  variable: "--font-mplus",
  display: "swap",
});

const noto = Noto_Sans_JP({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext", "cyrillic", "vietnamese"],
  variable: "--font-noto",
  display: "swap",
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
    <html lang="en" suppressHydrationWarning className="h-full">
      <body
        className={cn(
          "flex min-h-screen h-full flex-col font-fredoka bg-background antialiased p-0",
          fredoka.variable,
          inter.variable,
          mono.variable,
          mplus.variable,
          noto.variable,
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
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </ThemeProvider>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
