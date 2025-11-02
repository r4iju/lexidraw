import { TRPCReactProvider } from "~/trpc/react";

export default async function TRPCProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TRPCReactProvider>{children}</TRPCReactProvider>;
}
