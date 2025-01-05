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
      icon: <Brush className="h-25 w-25" />,
      href: newItem("drawing"),
      description: "For creating visual content.",
    },
    {
      title: "Document",
      icon: <File className="h-25 w-25" />,
      href: newItem("document"),
      description: "For creating rich text documents.",
    },
    {
      title: "Folder",
      icon: <FolderPlus className="h-25 w-25" />,
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
            <ul className="grid w-[200px] gap-3 p-4 md:w-[250px] md:grid-cols-1 lg:w-[300px] ">
              {items.map((component) => (
                <ListItem
                  key={component.title}
                  title={component.title}
                  href={component.href}
                  icon={component.icon}
                >
                  {component.description}
                </ListItem>
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
  icon: JSX.Element;
  href: string;
  children?: React.ReactNode;
};

const ListItem = ({
  className,
  title,
  icon,
  href,
  children,
}: ListItemProps) => (
  <li>
    <NavigationMenuLink asChild>
      <a
        href={href}
        className={cn(
          "flex items-center gap-3 select-none rounded-md p-3 no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          className,
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span>
          <div className="text-sm font-medium">{title}</div>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {children}
          </p>
        </span>
      </a>
    </NavigationMenuLink>
  </li>
);

ListItem.displayName = "ListItem";
