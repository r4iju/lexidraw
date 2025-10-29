"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav() {
  const pathname = usePathname();
  const inLlm = pathname.startsWith("/admin/llm");

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin{inLlm ? " · LLM" : ""}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/llm" className="underline-offset-4 hover:underline">
            LLM
          </Link>
          <Link href="/admin/users" className="underline-offset-4 hover:underline">
            Users
          </Link>
          <Link href="/admin/entities" className="underline-offset-4 hover:underline">
            Entities
          </Link>
        </nav>
      </div>
      {inLlm && (
        <nav className="mt-4 flex gap-4 text-sm">
          <Link href="/admin/llm" className="underline-offset-4 hover:underline">
            Overview
          </Link>
          <Link href="/admin/llm/policies" className="underline-offset-4 hover:underline">
            Policies
          </Link>
          <Link href="/admin/llm/users" className="underline-offset-4 hover:underline">
            Users
          </Link>
          <Link href="/admin/llm/usage" className="underline-offset-4 hover:underline">
            Usage
          </Link>
        </nav>
      )}
    </div>
  );
}


