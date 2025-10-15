import type { ReactNode } from "react";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

type Props = {
  children: ReactNode;
};

export const metadata = {
  title: "Dashboard",
  description: "Dashboard",
};

export default function Layout({ children }: Props) {
  return (
    <div className="grid h-full min-h-0 max-w-[100dvw] overflow-hidden grid-rows-[minmax(var(--header-height),auto)_1fr_minmax(var(--footer-height),auto)]">
      <Header />
      <div className="min-h-0 h-full">{children}</div>
      <Footer />
    </div>
  );
}
