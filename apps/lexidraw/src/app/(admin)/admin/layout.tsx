import { assertAdminOrRedirect } from "~/server/admin";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertAdminOrRedirect();
  return (
    <div className="grid h-full min-h-0 max-w-[100dvw] overflow-hidden grid-rows-[minmax(var(--header-height),auto)_1fr_minmax(var(--footer-height),auto)]">
      <Header />
      <div className="min-h-0 h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-6">
          {children}
        </div>
      </div>
      <Footer />
    </div>
  );
}
