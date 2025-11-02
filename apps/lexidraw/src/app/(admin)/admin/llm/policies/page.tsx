"use cache: private";

import { Suspense } from "react";
import { api } from "~/trpc/server";
import { PoliciesEditor } from "./policy-editor";

async function AdminLlmPoliciesContent() {
  const policies = await api.adminLlm.policies.getAll.query();
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

export default async function AdminLlmPoliciesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Loading policies…
        </div>
      }
    >
      <AdminLlmPoliciesContent />
    </Suspense>
  );
}
