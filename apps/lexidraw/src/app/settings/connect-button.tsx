"use client";

import { signIn } from "next-auth/react";
import { PROVIDER_BRANDING } from "~/components/sign-in-provider-branding";
import { Button } from "~/components/ui/button";
import type { SignInProvider } from "~/lib/sign-in-providers";

export function ConnectButton({ provider }: { provider: SignInProvider }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        signIn(provider, { callbackUrl: "/settings#settings-sign-in" })
      }
    >
      Connect {PROVIDER_BRANDING[provider].name}
    </Button>
  );
}
