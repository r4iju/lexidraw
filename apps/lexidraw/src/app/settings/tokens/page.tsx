import { Suspense } from "react";
import { api } from "~/trpc/server";
import { Card } from "~/components/ui/card";
import { TokensPanel } from "./tokens-panel";

async function TokensContent() {
  const tokens = await api.tokens.list.query();
  return <TokensPanel tokens={tokens} />;
}

export default function TokensSettingsPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex h-full min-h-[calc(100vh-56px-65px)] flex-col w-full"
    >
      <div className="flex-1 overflow-y-auto w-full">
        <div className="flex flex-col gap-4 items-center p-4">
          <Card className="w-full max-w-3xl">
            <div className="p-6">
              <h2 className="mb-1 text-2xl font-bold text-foreground">
                API tokens
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Personal access tokens let the Lexidraw CLI and other agents act
                as you. A token is shown once, when it is created.
              </p>
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">Loading…</p>
                }
              >
                <TokensContent />
              </Suspense>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
