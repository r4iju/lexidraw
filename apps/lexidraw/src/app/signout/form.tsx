"use client";

import { signOut } from "next-auth/react";
import { Button } from "~/components/ui/button";
import { LogOutIcon } from "lucide-react";

export default function SignInForm() {
  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <Button
      variant="destructive-confirm"
      onClick={handleSignOut}
      className="w-full"
    >
      <LogOutIcon className="mr-4" />
      Sign Out
    </Button>
  );
}
