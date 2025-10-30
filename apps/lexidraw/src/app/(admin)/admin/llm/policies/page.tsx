export const dynamic = "force-dynamic";

import { api } from "~/trpc/server";
import { PoliciesEditor } from "./policy-editor";

export default async function AdminLlmPoliciesPage() {
  const policies = await api.adminLlm.policies.getAll.query();
  // Normalize null to undefined for extraConfig to match component type
  const normalizedPolicies = policies.map((p) => ({
    ...p,
    extraConfig: p.extraConfig ?? undefined,
  }));
  return (
    <div className="grid gap-6">
      <div className="text-sm text-foreground/70">
        Configure defaults and caps per mode. Values are normalized server-side.
      </div>
      <PoliciesEditor initialPolicies={normalizedPolicies} />
    </div>
  );
}
