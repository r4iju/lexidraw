"use client";

import React, { PropsWithChildren } from "react";
import clsx from "clsx";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";

interface SidebarWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  widthClass?: string; // Optional width class override
  className?: string; // Optional additional classes for aside
}

export const SidebarWrapper: React.FC<
  PropsWithChildren<SidebarWrapperProps>
> = ({
  isOpen,
  onClose,
  title,
  children,
  widthClass = "w-[360px]", // Default width
  className,
}) => {
  return (
    <aside
      className={clsx(
        // Base styles
        "fixed right-0 top-0 h-full border-l bg-popover shadow-lg transition-transform duration-300 ease-in-out z-40",
        widthClass, // Apply width
        // Visibility
        isOpen ? "translate-x-0" : "translate-x-full",
        className, // Apply additional classes
      )}
    >
      <Card className="flex h-full flex-col rounded-none border-none">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b shrink-0">
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
        <CardContent className="flex-1 overflow-y-auto p-4">
          {children}
        </CardContent>
      </Card>
    </aside>
  );
};
