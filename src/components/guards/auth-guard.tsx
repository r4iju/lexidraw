"use client";

import { type SessionContextValue, useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { type Session } from "next-auth";
import { redirect } from "next/navigation";

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

export default function AuthGuard({ children }: Props) {
  const { status, data } = useSession();

  return (
    <>
      {status === "loading" ? (
        <div className="min-h-[90vh]">
          <div className="flex h-full items-center justify-center">Loading...</div>
        </div>
      ) : (
        <Container session={data} status={status}>
          {children}
        </Container>
      )}
    </>
  );
}

// ----------------------------------------------------------------------

type ContainerProps = {
  status: SessionContextValue["status"];
  session: Session | null;
  children: React.ReactNode;
};

function Container({ status, session, children }: ContainerProps) {
  const [checked, setChecked] = useState(false);

  const check = useCallback(() => {
    if (status !== "authenticated" || !session) {
      redirect("/auth/signin");
    }
    setChecked(true);
  }, [status, session]);

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) {
    return null;
  }

  return <>{children}</>;
}
