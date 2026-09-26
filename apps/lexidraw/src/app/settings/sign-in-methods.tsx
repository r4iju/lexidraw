import { PROVIDER_BRANDING } from "~/components/sign-in-provider-branding";
import type { SignInProvider } from "~/lib/sign-in-providers";
import { ConnectButton } from "./connect-button";

export function SignInMethodsSection({
  methods,
}: {
  methods: { provider: SignInProvider; connected: boolean }[];
}) {
  return (
    <section
      id="settings-sign-in"
      aria-labelledby="settings-sign-in-heading"
      className="flex scroll-mt-[calc(var(--app-bar-height)+1rem)] flex-col gap-1"
    >
      <h2 id="settings-sign-in-heading" className="text-lg font-semibold">
        Sign-in methods
      </h2>
      <p className="text-sm text-muted-foreground">
        Other accounts you can sign in with.
      </p>
      <ul className="mt-5 flex flex-col gap-3">
        {methods.map(({ provider, connected }) => {
          const { name, Mark } = PROVIDER_BRANDING[provider];
          return (
            <li
              key={provider}
              className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 py-2"
            >
              <Mark className="size-4 shrink-0" />
              <span className="flex-1 font-medium">{name}</span>
              {connected ? (
                <span className="text-sm text-muted-foreground">Connected</span>
              ) : (
                <ConnectButton provider={provider} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
