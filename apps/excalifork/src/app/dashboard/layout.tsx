import AuthGuard from "~/components/guards/auth-guard";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

export default function Layout({ children }: Props) {
  return (
    <>
      <Header />
      <AuthGuard>{children}</AuthGuard>
      <Footer />
    </>
  );
}
