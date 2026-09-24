import { Suspense } from "react";
import type { Metadata } from "next/types";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./skeleton";
import { appBarAccount } from "~/server/app-bar-account";
import { resolveDashboardQuery } from "./dashboard-query";

export const metadata: Metadata = {
  title: "Home",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function DashboardContent({ searchParams }: Props) {
  const account = await appBarAccount();
  const query = await resolveDashboardQuery(await searchParams);
  return <Dashboard {...query} account={account} />;
}

export default async function DashboardPage(props: Props) {
  const { flex } = await resolveDashboardQuery(await props.searchParams);
  return (
    <Suspense fallback={<DashboardSkeleton flex={flex} />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
