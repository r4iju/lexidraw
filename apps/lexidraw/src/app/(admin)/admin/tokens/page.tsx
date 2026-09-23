import { Suspense } from "react";
import { api } from "~/trpc/server";
import { AdminTokensTable } from "./table";

async function AdminTokensContent() {
  const rows = await api.adminTokens.list.query();
  return <AdminTokensTable rows={rows} />;
}

export default function AdminTokensPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">API tokens</h1>
        <p className="text-sm text-muted-foreground">
          Every personal access token across all users.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground">
            Loading tokens…
          </div>
        }
      >
        <AdminTokensContent />
      </Suspense>
    </div>
  );
}
