"use client";

import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "~/lib/utils";
import { Dialog, DialogContent } from "~/components/ui/dialog";

type CommandProps = React.ComponentPropsWithRef<typeof CommandPrimitive>;

const Command = ({ className, ...props }: CommandProps) => (
  <CommandPrimitive
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className,
    )}
    {...props}
  />
);

Command.displayName = CommandPrimitive.displayName;

type CommandDialogProps = DialogProps;

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

type CommandInputProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.Input
> & { wrapperClassName?: string };

const CommandInput = ({
  className,
  wrapperClassName,
  ...props
}: CommandInputProps) => (
  <div
    className={cn("flex items-center px-3", wrapperClassName)}
    cmdk-input-wrapper=""
  >
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      className={cn(
        "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
);

CommandInput.displayName = CommandPrimitive.Input.displayName;

type CommandListProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.List
>;

const CommandList = ({ className, ...props }: CommandListProps) => (
  <CommandPrimitive.List
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
);

CommandList.displayName = CommandPrimitive.List.displayName;

type CommandEmptyProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.Empty
>;

const CommandEmpty = (props: CommandEmptyProps) => (
  <CommandPrimitive.Empty className="py-6 text-center text-sm" {...props} />
);

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

type CommandGroupProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.Group
>;

const CommandGroup = ({ className, ...props }: CommandGroupProps) => (
  <CommandPrimitive.Group
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
);

CommandGroup.displayName = CommandPrimitive.Group.displayName;

type CommandSeparatorProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.Separator
>;

const CommandSeparator = ({ className, ...props }: CommandSeparatorProps) => (
  <CommandPrimitive.Separator
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
);

CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

type CommandItemProps = React.ComponentPropsWithRef<
  typeof CommandPrimitive.Item
>;

const CommandItem = ({ className, ...props }: CommandItemProps) => (
  <CommandPrimitive.Item
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-hidden aria-selected:bg-accent aria-selected:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);

CommandItem.displayName = CommandPrimitive.Item.displayName;

type CommandShortcutProps = React.HTMLAttributes<HTMLSpanElement>;

const CommandShortcut = ({ className, ...props }: CommandShortcutProps) => (
  <span
    className={cn(
      "ml-auto text-xs tracking-widest text-muted-foreground",
      className,
    )}
    {...props}
  />
);

CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
