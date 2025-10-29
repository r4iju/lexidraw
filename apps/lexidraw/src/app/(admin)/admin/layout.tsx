import { assertAdminOrRedirect } from "~/server/admin";
import AdminNav from "./_components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertAdminOrRedirect();
  return (
    <div className="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
        <AdminNav />
        {children}
      </div>
    </div>
  );
}
