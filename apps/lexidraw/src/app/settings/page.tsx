import { Suspense } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { offeredProviders } from "~/server/auth";
import { api } from "~/trpc/server";
import { ApiTokensSection } from "./api-tokens";
import { DeleteAccountSection } from "./delete-account";
import { SettingsFormSection } from "./settings-form";
import { SettingsNav } from "./settings-nav";
import { SignInMethodsSection } from "./sign-in-methods";

async function SettingsContent() {
  const [user, policies, autoSave, tokens, linked] = await Promise.all([
    api.auth.getProfile.query(),
    api.adminLlm.policies.getDefaults.query(),
    api.config.getAutoSaveConfig.query(),
    api.tokens.list.query(),
    api.auth.signInProviders.query(),
  ]);
  return (
    <>
      <SettingsFormSection
        user={user}
        policies={policies}
        autoSave={autoSave.enabled}
      />
      <SignInMethodsSection
        methods={offeredProviders.map((provider) => ({
          provider,
          connected: linked.includes(provider),
        }))}
      />
      <ApiTokensSection tokens={tokens} />
      <DeleteAccountSection account={user} />
    </>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row md:gap-12"
    >
      <aside className="md:w-44 md:shrink-0">
        <div className="flex flex-col gap-4 md:sticky md:top-[calc(var(--app-bar-height)+2rem)]">
          <h1 className="text-title font-semibold">Settings</h1>
          <SettingsNav />
        </div>
      </aside>
      <div className="flex w-full max-w-[560px] flex-col gap-12">
        <Suspense fallback={<SettingsSkeleton />}>
          <SettingsContent />
        </Suspense>
      </div>
    </main>
  );
}
