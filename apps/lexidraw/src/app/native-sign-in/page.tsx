import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthCard } from "~/components/auth-card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { auth } from "~/server/auth";
import { NativeSignInRequest } from "~/server/auth/native-sign-in";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Where a native app opens the system browser. Signing in is the web's own
 * sign-in; this page asks the signed-in user to approve the device, and only
 * the approval, a POST from this page, sends a code to the app. A signed-in
 * browser never hands one over on a GET alone (RFC 8252 §8.6).
 */
export default function NativeSignInPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <AuthCard title="Sign in to the app">
          <Skeleton className="h-10 w-full" />
        </AuthCard>
      }
    >
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

async function Consent({ searchParams }: Props) {
  const request = NativeSignInRequest.safeParse(await searchParams);
  if (!request.success) {
    return (
      <AuthCard title="This sign-in link doesn’t work">
        <p className="text-sm text-muted-foreground">
          Go back to the app and start signing in again.
        </p>
      </AuthCard>
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    const here = `/native-sign-in?${new URLSearchParams(request.data)}`;
    redirect(`/signin?${new URLSearchParams({ callbackUrl: here })}`);
  }

  const { deviceName } = request.data;
  const who = session.user.email ?? session.user.name;
  return (
    <AuthCard
      title={`Sign in on ${deviceName}?`}
      description={
        <>
          {deviceName} will be able to open, edit and delete your files
          {who ? ` as ${who}` : ""}. You can revoke it at any time under API
          tokens in Settings.
        </>
      }
    >
      <form method="post" action="/native-sign-in/approve">
        {Object.entries(request.data).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
