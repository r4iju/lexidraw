import type { ReactNode } from "react";
import Footer from "~/sections/footer";
import Header from "~/sections/header";
import Contexts from "./contexts";

type Props = {
  children: ReactNode;
};

export default function Layout({ children }: Props) {
  return (
    <>
      <Header />
      <Contexts>{children}</Contexts>
      <Footer />
    </>
  );
}
