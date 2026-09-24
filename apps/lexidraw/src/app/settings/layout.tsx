import { Suspense } from "react";
import type { Metadata } from "next";
import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { PageFrame } from "~/sections/page-frame";
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

// Settings scrolls as a page, so its bar holds on top as the document's does.
const STICKY = "sticky top-0 z-40";

async function SignedInAppBar() {
  return (
    <AppBar
      account={await appBarAccount()}
      crumbs={crumbs}
      className={STICKY}
    />
  );
}

export default function SettingsLayout({ children }: Props) {
  return (
    <PageFrame
      bar={
        <Suspense
          fallback={
            <AppBar account={undefined} crumbs={crumbs} className={STICKY} />
          }
        >
          <SignedInAppBar />
        </Suspense>
      }
    >
      {children}
    </PageFrame>
  );
}
