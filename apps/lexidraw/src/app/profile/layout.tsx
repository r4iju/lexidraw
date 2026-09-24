import { Suspense } from "react";
import type { Metadata } from "next";
import Footer from "~/sections/footer";
import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { appBarAccount } from "~/server/app-bar-account";

export const metadata: Metadata = { title: "Settings" };

type Props = {
  children: React.ReactNode;
};

const crumbs = (
  <Crumb current>
    <span className="truncate px-1.5 font-medium">Settings</span>
  </Crumb>
);

async function SignedInAppBar() {
  return <AppBar account={await appBarAccount()} crumbs={crumbs} />;
}

export default function DefaultLayout({ children }: Props) {
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
