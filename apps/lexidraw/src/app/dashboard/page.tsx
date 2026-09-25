import type { Metadata } from "next/types";
import { Dashboard } from "./dashboard";
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

/** Home; `loading.tsx` stands in while it loads. */
export default async function DashboardPage({ searchParams }: Props) {
  const [account, query] = await Promise.all([
    appBarAccount(),
    searchParams.then(resolveDashboardQuery),
  ]);
  return <Dashboard {...query} account={account} />;
}
