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
import { Brush, File, FolderPlus, Plus } from "lucide-react";
import Link from "next/link";

type Props = {
  parentId: string | null;
};

export function NewEntity({ parentId }: Props) {
  const newItem = (kind: "drawing" | "document" | "directory") => {
    const query = `?new=true${parentId ? `&parentId=${parentId}` : ""}`;
    switch (kind) {
      case "drawing":
        return `/drawings/${uuidv4()}${query}`;
      case "document":
        return `/documents/${uuidv4()}${query}`;
      case "directory":
        return `/dashboard/${uuidv4()}${query}`;
    }
  };

  const items: {
    title: string;
    icon: JSX.Element;
    href: string;
    description: string;
  }[] = [
    {
      title: "Drawing",
      icon: <Brush className="size-5" />,
      href: newItem("drawing"),
      description: "For creating visual content.",
    },
    {
      title: "Document",
      icon: <File className="size-5" />,
      href: newItem("document"),
      description: "For creating rich text documents.",
    },
    {
      title: "Folder",
      icon: <FolderPlus className="size-5" />,
      href: newItem("directory"),
      description: "Create a folder.",
    },
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
              {items.map((component) => (
                <ListItem
                  key={component.title}
                  title={component.title}
                  description={component.description}
                  href={component.href}
                  icon={component.icon}
                ></ListItem>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

type ListItemProps = {
  className?: string;
  title: string;
  description: string;
  icon: JSX.Element;
  href: string;
};

const ListItem = ({ className, title, description, icon, href }: ListItemProps) => (
  <li>
    <NavigationMenuLink asChild>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 select-none rounded-md p-3 no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          className,
        )}
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
