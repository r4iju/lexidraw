import { api } from "~/trpc/server";
import { PoliciesEditor } from "./policy-editor";

export default async function AdminLlmPoliciesPage() {
  const policies = await api.adminLlm.policies.getAll.query();
  return (
    <div className="grid gap-6">
      <div className="text-sm text-foreground/70">
        Configure defaults and caps per mode. Values are normalized server-side.
      </div>
      <PoliciesEditor initialPolicies={policies} />
    </div>
  );
}
