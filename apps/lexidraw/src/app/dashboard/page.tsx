import type { Metadata, ServerRuntime } from "next/types";
import { Dashboard } from "./dashboard";

export const runtime: ServerRuntime = "edge";

export const metadata: Metadata = {
  title: "Lexidraw | Dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

export default async function DashboardPage() {
  return <Dashboard />;
}
