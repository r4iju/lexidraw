"use client";
import { useTransition } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";

export default function StopImpersonationButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const stop = api.adminUsers.impersonateStop.useMutation();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || stop.isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            await stop.mutateAsync();
          } finally {
            router.refresh();
          }
        });
      }}
    >
      Stop impersonating
    </Button>
  );
}
