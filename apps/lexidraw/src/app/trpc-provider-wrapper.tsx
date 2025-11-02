import { headers } from "next/headers";
import { TRPCReactProvider } from "~/trpc/react";

export default async function TRPCProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const plainHeaders = new Map(headersList.entries());

  return (
    <TRPCReactProvider headers={plainHeaders}>{children}</TRPCReactProvider>
  );
}
