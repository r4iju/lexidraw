import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
import type { ServerRuntime } from "next";
import { parseExpression } from "cron-parser";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ClientButton } from "./client-button";

export const dynamic = "force-dynamic";
export const runtime: ServerRuntime = "nodejs";

export default async function SignInPage() {
  const crons = await api.crons.list.query();

  const nextRun = (schedule: string) => {
    const cron = parseExpression(schedule);
    return cron.next().toDate();
  };

  const lastRun = (schedule: string) => {
    const cron = parseExpression(schedule);
    return cron.prev().toDate();
  };

  return (
    <main className=" flex h-full flex-col items-center justify-center ">
      <div className="w-full rounded  border p-6 shadow-lg md:max-w-2xl">
        <h2 className="mb-4 text-center text-2xl font-bold text-foreground">
          Jobs
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {crons.map((cron) => (
              <TableRow key={cron.path}>
                <TableCell>{cron.path}</TableCell>
                <TableCell>{cron.schedule}</TableCell>
                <TableCell>{nextRun(cron.schedule).toLocaleString()}</TableCell>
                <TableCell>{lastRun(cron.schedule).toLocaleString()}</TableCell>
                <TableCell>
                  <ClientButton path={cron.path} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button asChild variant="link">
        <Link href="/dashboard">Go to my drawings</Link>
      </Button>
    </main>
  );
}
