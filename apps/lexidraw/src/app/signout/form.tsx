"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";

export default function SignOutForm() {
  const [pending, setPending] = useState(false);
  const handleSignOut = async () => {
    setPending(true);
    await signOut({ callbackUrl: "/" });
  };

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button asChild variant="outline">
        <Link href="/dashboard">Cancel</Link>
      </Button>
      <Button onClick={handleSignOut} disabled={pending} pending={pending}>
        Sign out
      </Button>
    </div>
  );
}
