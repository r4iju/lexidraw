import { assertAdminOrRedirect } from "~/server/admin";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertAdminOrRedirect();
  return (
    <div className="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/admin/llm"
              className="underline-offset-4 hover:underline"
            >
              LLM
            </Link>
            <Link
              href="/admin/users"
              className="underline-offset-4 hover:underline"
            >
              Users
            </Link>
            <Link
              href="/admin/entities"
              className="underline-offset-4 hover:underline"
            >
              Entities
            </Link>
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}
