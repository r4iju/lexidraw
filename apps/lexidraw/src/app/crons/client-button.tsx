"use client";

import { Button } from "~/components/ui/button";

export function ClientButton({ path }: { path: string }) {
  const run = async () => {
    const response = await fetch(path, {
      method: "GET",
    });
    console.log(response);
  };

  return (
    <Button variant="outline" onClick={run}>
      Run
    </Button>
  );
}
