"use client";

import { signIn } from "next-auth/react";
import { PROVIDER_BRANDING } from "~/components/sign-in-provider-branding";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { SignInProvider } from "~/lib/sign-in-providers";
import type { SameSitePath } from "~/app/signin/callback-path";

/** A "Continue with" button for each provider on offer. */
export function ContinueWith({
  providers,
  callbackPath,
}: {
  providers: readonly SignInProvider[];
  callbackPath: SameSitePath;
}) {
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => {
        const { name, Mark, button } = PROVIDER_BRANDING[provider];
        return (
          <Button
            key={provider}
            variant={button.variant}
            className={cn("w-full gap-2", button.className)}
            onClick={() => signIn(provider, { callbackUrl: callbackPath })}
          >
            <Mark className="size-4" />
            Continue with {name}
          </Button>
        );
      })}
    </div>
  );
}
