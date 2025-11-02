import { Suspense } from "react";
import { assertAdminOrRedirect } from "~/server/admin";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

async function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  await assertAdminOrRedirect();
  return (
    <div className="grid h-full min-h-0 max-w-[100dvw] overflow-hidden grid-rows-[minmax(var(--header-height),auto)_1fr_minmax(var(--footer-height),auto)]">
      <Header />
      <div className="min-h-0 h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-6">{children}</div>
      </div>
      <Footer />
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="grid h-full min-h-0 max-w-[100dvw] overflow-hidden grid-rows-[minmax(var(--header-height),auto)_1fr_minmax(var(--footer-height),auto)]">
          <div className="min-h-[var(--header-height)] border-b border-border" />
          <div className="min-h-0 h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl p-6 text-sm text-muted-foreground">
              Loading…
            </div>
          </div>
          <div className="min-h-[var(--footer-height)] border-t border-border" />
        </div>
      }
    >
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </Suspense>
  );
}
