import type { ReactNode } from "react";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

type Props = {
  children: ReactNode;
};

export default function Layout({ children }: Props) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
