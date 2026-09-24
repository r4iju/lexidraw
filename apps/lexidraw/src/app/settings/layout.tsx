import { Suspense } from "react";
import type { Metadata } from "next";
import Footer from "~/sections/footer";
import { AppBar, Crumb, CrumbLink } from "~/components/app-bar/app-bar";
import { appBarAccount } from "~/server/app-bar-account";

export const metadata: Metadata = { title: "API tokens" };

type Props = {
  children: React.ReactNode;
};

const crumbs = (
  <>
    <Crumb>
      <CrumbLink href="/profile">Settings</CrumbLink>
    </Crumb>
    <Crumb current>
      <span className="truncate px-1.5 font-medium">API tokens</span>
    </Crumb>
  </>
);

async function SignedInAppBar() {
  return <AppBar account={await appBarAccount()} crumbs={crumbs} />;
}

export default function SettingsLayout({ children }: Props) {
  return (
    <>
      <Suspense fallback={<AppBar account={undefined} crumbs={crumbs} />}>
        <SignedInAppBar />
      </Suspense>
      {children}
      <Footer />
    </>
  );
}
