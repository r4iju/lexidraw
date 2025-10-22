// DOM-related helpers intentionally kept in a React-free module so the
// React Compiler does not attempt to transform these utilities as hooks.

export const getParentWindow = (node?: HTMLDivElement | null): Window => {
  // Use the ownerDocument's defaultView when available (e.g., if inside an iframe)
  // Fallback to the global `self` which is the correct window-like in browsers and workers
  return node?.ownerDocument?.defaultView || self;
};
