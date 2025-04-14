import type { Metadata, ServerRuntime } from "next/types";
import { Dashboard } from "./dashboard";
import { z } from "zod";

export const runtime: ServerRuntime = "edge";

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
});

type Sort = z.infer<typeof Sort>;

type Props = {
  searchParams: Promise<Sort>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const queryParams = await searchParams;
  const query = Sort.parse(queryParams);
  return <Dashboard {...query} />;
}
