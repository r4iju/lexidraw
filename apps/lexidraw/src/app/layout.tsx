import "~/styles/globals.css";

import {
  Noto_Sans_JP,
  Fredoka,
  Inter,
  Anonymous_Pro,
  M_PLUS_Rounded_1c,
} from "next/font/google";
import { headers as nextHeaders } from "next/headers";
import { TRPCReactProvider } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { ToastProvider } from "~/components/ui/toast-provider";

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

export default async function RootLayout({ children }: Props) {
  const headersList = await nextHeaders();
  const plainHeaders = new Map(headersList.entries());

  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={{
        scrollbarGutter: "stable both-edges",
      }}
    >
      <body
        className={cn(
          "min-h-screen size-full flex flex-col font-fredoka bg-background antialiased p-0 ",
          fredoka.variable,
          inter.variable,
          mono.variable,
          mplus.variable,
          noto.variable,
        )}
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
                <ToastProvider>{children}</ToastProvider>
              </TooltipProvider>
            </ThemeProvider>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
