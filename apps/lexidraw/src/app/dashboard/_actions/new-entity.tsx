"use client";

import type { JSX } from "react";
import { v4 as uuidv4 } from "uuid";
import { cn } from "~/lib/utils";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "~/components/ui/navigation-menu";
import { Plus } from "lucide-react";
import { EntityTypeIcon, entityTypeLabel } from "~/lib/entity-types";
import Link from "next/link";
import { useState } from "react";
import CreateUrlModal from "./create-url-modal";

type Props = {
  parentId: string | null;
};

export function NewEntity({ parentId }: Props) {
  const [isCreateUrlOpen, setIsCreateUrlOpen] = useState(false);

  const newItem = (kind: "drawing" | "document" | "directory" | "url") => {
    const query = `?new=true${parentId ? `&parentId=${parentId}` : ""}`;
    switch (kind) {
      case "drawing":
        return `/drawings/${uuidv4()}${query}`;
      case "document":
        return `/documents/${uuidv4()}${query}`;
      case "directory":
        return `/dashboard/${uuidv4()}${query}`;
      case "url":
        return "#";
    }
  };

  const items: {
    type: "document" | "drawing" | "directory" | "url";
    description: string;
  }[] = [
    {
      type: "document",
      description: "Write with headings, tables, embeds and slides.",
    },
    {
      type: "drawing",
      description: "Sketch diagrams and wireframes on a canvas.",
    },
    { type: "directory", description: "Group files together." },
    { type: "url", description: "Save a web page to read or listen to later." },
  ];

  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>
            <Plus className="mr-4" />
            New
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-52 md:w-64 lg:w-72 gap-2 md:grid-cols-1 p-2">
              {items.map(({ type, description }) => (
                <ListItem
                  key={type}
                  title={entityTypeLabel(type)}
                  description={description}
                  href={newItem(type)}
                  icon={<EntityTypeIcon type={type} className="size-5" />}
                  onOpenCreate={
                    type === "url" ? () => setIsCreateUrlOpen(true) : undefined
                  }
                />
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
      <CreateUrlModal
        parentId={parentId}
        open={isCreateUrlOpen}
        onOpenChange={setIsCreateUrlOpen}
      />
    </NavigationMenu>
  );
}

type ListItemProps = {
  className?: string;
  title: string;
  description: string;
  icon: JSX.Element;
  href: string;
  /** Opens a dialog in place of following the link. */
  onOpenCreate?: () => void;
};

const ListItem = ({
  className,
  title,
  description,
  icon,
  href,
  onOpenCreate,
}: ListItemProps) => (
  <li>
    <NavigationMenuLink asChild>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 select-none rounded-md p-3 no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          className,
        )}
        onClick={(e) => {
          if (onOpenCreate) {
            e.preventDefault();
            onOpenCreate();
          }
        }}
      >
        <span className="shrink-0">{icon}</span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{title}</span>
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {description}
          </span>
        </div>
      </Link>
    </NavigationMenuLink>
  </li>
);

ListItem.displayName = "ListItem";
