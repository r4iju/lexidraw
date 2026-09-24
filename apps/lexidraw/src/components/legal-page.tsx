import type { ReactNode } from "react";
import { LEGAL } from "~/lib/legal";

/** The shared frame of the terms and the privacy policy: one readable column. */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 md:py-16"
    >
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{intro}</p>
        <p className="text-sm text-muted-foreground">
          Last updated {LEGAL.lastUpdated}.
        </p>
      </header>
      <div className="flex flex-col gap-8 leading-relaxed [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        {children}
      </div>
    </main>
  );
}

export function Operator() {
  return (
    <a
      href={LEGAL.operatorUrl}
      className="text-primary underline-offset-4 hover:underline"
    >
      {LEGAL.operator}
    </a>
  );
}

export function Contact() {
  return (
    <a
      href={LEGAL.contactUrl}
      className="text-primary underline-offset-4 hover:underline"
    >
      {LEGAL.contactLabel}
    </a>
  );
}
