"use cache: private";

import { Suspense } from "react";
import { cacheTag } from "next/cache";
import { entityTag } from "~/server/api/entity-cache";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";
import { Dashboard } from "../dashboard";
import { DashboardSkeleton } from "../skeleton";
import type { Metadata } from "next";
import { appBarAccount } from "~/server/app-bar-account";
import { resolveDashboardQuery } from "../dashboard-query";

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function DashboardContent({ params, searchParams }: Props) {
  const account = await appBarAccount();
  const directoryId = (await params).directoryId;
  const query = await resolveDashboardQuery(await searchParams);
  const directory = await api.entities.getMetadata
    .query({ id: directoryId })
    .catch(notFoundOr);

  return <Dashboard account={account} directory={directory} {...query} />;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { directoryId } = await props.params;
  cacheTag(entityTag(directoryId));
  const directory = await api.entities.getMetadata
    .query({ id: directoryId })
    .catch(() => null);
  return { title: directory?.title || "Home" };
}

export default async function DashboardPage(props: Props) {
  // The listing this render shows, so a child created, deleted, renamed, or
  // moved over any transport drops it. Tagged here rather than in
  // `DashboardContent`, which the Suspense boundary may render after this
  // cached scope has closed.
  cacheTag(entityTag((await props.params).directoryId));
  return (
    <Suspense fallback={<DashboardSkeleton folder />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
