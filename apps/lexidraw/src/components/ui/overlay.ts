import { createContext, useContext } from "react";
import { useLayoutClass } from "~/hooks/use-media-query";

/** Whether floating content opens as a bottom sheet: on a phone, unless opted out. */
export function useSheet(wanted = true) {
  return useLayoutClass() === "phone" && wanted;
}

/** Set by a menu opened as a sheet, so its submenus drill down inside it. */
export const InSheet = createContext(false);
export const useInSheet = () => useContext(InSheet);

/** One surface, padding and focus ring for every menu, select and popover. */
export const floating =
  "z-50 rounded-lg border border-border-subtle bg-popover text-popover-foreground shadow-(--elevation-overlay) outline-hidden";

export const floatingMotion =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

/**
 * A bottom sheet over a scrim, above the keyboard and the home indicator.
 * globals.css pins its popper wrapper (`[data-sheet]`) to the bottom edge.
 */
export const sheet =
  "w-screen max-w-none min-w-0 max-h-[min(85dvh,calc(var(--dynamic-viewport-height)-var(--keyboard-inset)-3rem))] rounded-b-none rounded-t-xl border-x-0 border-b-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_0_0_100vmax_var(--scrim)] overflow-y-auto overscroll-contain data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

/** A 32px row, 44px under a finger, with a 16px slot for its icon even when it has none. */
export const menuRow =
  "relative flex min-h-8 pointer-coarse:min-h-11 cursor-default select-none items-center gap-2 rounded-sm py-1 pl-8 pr-2 text-sm outline-hidden transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>svg:first-child:not([data-chevron])]:absolute [&>svg:first-child:not([data-chevron])]:left-2";
