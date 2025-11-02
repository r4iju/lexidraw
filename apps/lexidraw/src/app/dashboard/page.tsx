"use cache: private";

import { Suspense } from "react";
import type { Metadata } from "next/types";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./skeleton";
import { z } from "zod";

export const metadata: Metadata = {
  title: "Lexidraw | Dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

const Sort = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  flex: z.enum(["flex-row", "flex-col"]).default("flex-col"),
  tags: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  onlyFavorites: z.coerce.boolean().optional().default(false),
});

type Sort = z.infer<typeof Sort>;

type Props = {
  searchParams: Promise<Sort>;
};

async function DashboardContent({ searchParams }: Props) {
  const queryParams = await searchParams;
  const query = Sort.parse(queryParams);
  return <Dashboard {...query} />;
}

export default async function DashboardPage(props: Props) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
