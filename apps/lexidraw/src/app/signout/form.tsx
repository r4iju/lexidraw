"use client";

import { signOut } from "next-auth/react";
import { Button } from "~/components/ui/button";
import { ExitIcon } from "@radix-ui/react-icons";

export default function SignInForm() {
  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <Button variant="destructive" onClick={handleSignOut} className="w-full">
      <ExitIcon className="mr-4" />
      Sign Out
    </Button>
  );
}
