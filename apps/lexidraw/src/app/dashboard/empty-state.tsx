import {
  ArchiveIcon,
  FolderOpenIcon,
  HeartIcon,
  SparklesIcon,
  TagIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardView } from "./view-filter";

type Props = {
  inFolder: boolean;
  view: DashboardView;
  tags?: string;
  pathname: string;
  searchParams: URLSearchParams;
  /** The New menu. */
  action: ReactNode;
};

/**
 * What Home says when a list has nothing in it, and why: a new account, an
 * empty folder, a view with nothing in it, or a filter that matches nothing.
 */
export function EmptyState({
  inFolder,
  view,
  tags,
  pathname,
  searchParams,
  action,
}: Props) {
  const tagList = (tags ?? "").split(",").filter(Boolean);
  const { icon, title, body } = tagList.length
    ? {
        icon: <TagIcon />,
        title: "No files match these filters",
        body: `Nothing ${VIEW_SCOPE[view]} is tagged ${tagList.join(", ")}.`,
      }
    : COPY[view === "all" ? (inFolder ? "folder" : "home") : view];

  const next = new URLSearchParams(searchParams);
  next.set("view", "all");
  if (tagList.length) next.set("tags", "");
  const clear =
    tagList.length || view !== "all"
      ? {
          label: tagList.length ? "Clear filters" : "Show all files",
          href: `${pathname}?${next.toString()}`,
        }
      : null;

  return (
    <EmptyMessage icon={icon} title={title} body={body}>
      {action}
      {clear && (
        <Link
          href={clear.href}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {clear.label}
        </Link>
      )}
    </EmptyMessage>
  );
}

/** How any list says it has nothing in it, with what to do about it below. */
export function EmptyMessage({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <h2 className="font-brand text-xl">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {children && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          {children}
        </div>
      )}
    </section>
  );
}

const COPY = {
  home: {
    icon: <SparklesIcon />,
    title: "Nothing here yet",
    body: "Create a document or a drawing to get started. Folders keep them together, and links save web pages to read later.",
  },
  folder: {
    icon: <FolderOpenIcon />,
    title: "This folder is empty",
    body: "Drag files here, or create something new.",
  },
  favorites: {
    icon: <HeartIcon />,
    title: "No favorites yet",
    body: "Choose Add to favorites from any file’s ⋯ menu to keep it here.",
  },
  archived: {
    icon: <ArchiveIcon />,
    title: "Nothing archived",
    body: "Archived files are hidden from Home but kept until you delete them.",
  },
} as const;

const VIEW_SCOPE: Record<DashboardView, string> = {
  all: "here",
  favorites: "in your favorites",
  archived: "archived",
};
