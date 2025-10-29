import { api } from "~/trpc/server";

export default async function AdminLlmUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await api.adminLlm.users.get.query({ id: params.id });
  if (!user)
    return <div className="text-sm text-foreground/70">User not found</div>;
  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-border p-4">
        <div className="text-sm font-medium">User</div>
        <div className="mt-2 text-sm">
          {user.name} · {user.email}
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <div className="text-sm font-medium">Overrides (read-only)</div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs">
          {JSON.stringify(user.config?.llm ?? null, null, 2)}
        </pre>
      </section>
    </div>
  );
}
