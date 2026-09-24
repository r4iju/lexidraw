import type { ReactNode } from "react";
import Footer from "./footer";
import { PageFrame } from "./page-frame";

/** The landing, sign-in and legal pages: the page, then the footer after it. */
export function MarketingFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      {children}
      <Footer />
    </PageFrame>
  );
}
