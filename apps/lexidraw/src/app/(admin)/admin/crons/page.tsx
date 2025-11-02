"use cache: private";

import { Suspense } from "react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
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

async function CronsContent() {
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
    <div className="w-full rounded-md border border-border p-6 shadow-lg md:max-w-2xl">
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
  );
}

export default async function SignInPage() {
  return (
    <main className=" flex h-full flex-col items-center justify-center ">
      <Suspense
        fallback={<div className="w-full md:max-w-2xl p-6">Loading…</div>}
      >
        <CronsContent />
      </Suspense>
      <Button asChild variant="link">
        <Link href="/dashboard">Go to my drawings</Link>
      </Button>
    </main>
  );
}
