"use client";

import React, { PropsWithChildren } from "react";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

interface SidebarWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  className?: string;
}

export const SidebarWrapper: React.FC<
  PropsWithChildren<SidebarWrapperProps>
> = ({ isOpen, onClose, title, children, className }) => {
  return (
    <aside
      className={cn(
        "fixed right-0 top-0 h-full w-[360px] flex flex-col border-l bg-popover shadow-lg transition-transform duration-300 ease-in-out z-40",
        {
          "translate-x-0": isOpen,
          "translate-x-full": !isOpen,
        },
        className,
      )}
    >
      <header className="flex items-center justify-between border-b shrink-0 px-4 py-2 w-full">
        <h2 className="text-lg font-semibold truncate pr-2">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close Sidebar"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>
      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
};
