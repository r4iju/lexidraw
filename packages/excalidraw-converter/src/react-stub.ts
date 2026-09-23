/**
 * React, as far as the bundled editor needs it to evaluate.
 *
 * Nothing here is ever called: the bundle's components are defined on import
 * and never rendered, and `convertToExcalidrawElements` is element maths. Only
 * the module-scope calls — `createContext`, `forwardRef`, `memo`, and a class
 * or two extending `Component` — have to answer with something of the right
 * shape. Every export React 19 has is listed because the bundler resolves
 * named imports statically, and a missing one fails the build.
 */
const noop = () => undefined;

export const createContext = (defaultValue: unknown) => ({
  $$typeof: Symbol.for("react.context"),
  _currentValue: defaultValue,
  Provider: { $$typeof: Symbol.for("react.provider") },
  Consumer: { $$typeof: Symbol.for("react.consumer") },
});
export const forwardRef = (render: unknown) => render;
export const memo = (component: unknown) => component;
export const lazy = (loader: unknown) => loader;
export const cache = (fn: unknown) => fn;
export const createElement = () => null;
export const cloneElement = () => null;
export const isValidElement = () => false;
export const createRef = () => ({ current: null });
export const startTransition = (fn: () => void) => fn();
export const flushSync = (fn: () => void) => fn();
export const unstable_batchedUpdates = (fn: () => void) => fn();

export const Fragment = Symbol.for("react.fragment");
export const Suspense = Symbol.for("react.suspense");
export const StrictMode = Symbol.for("react.strict_mode");
export const Profiler = Symbol.for("react.profiler");
export const Activity = Symbol.for("react.activity");
export const ViewTransition = Symbol.for("react.view_transition");
export const Children = {
  map: noop,
  forEach: noop,
  count: () => 0,
  toArray: () => [],
  only: noop,
};
export class Component {}
export class PureComponent {}
export const version = "19.0.0";

export const act = noop;
export const addTransitionType = noop;
export const cacheSignal = noop;
export const captureOwnerStack = noop;
export const use = noop;
export const useActionState = noop;
export const useCallback = noop;
export const useContext = noop;
export const useDebugValue = noop;
export const useDeferredValue = noop;
export const useEffect = noop;
export const useEffectEvent = noop;
export const useId = noop;
export const useImperativeHandle = noop;
export const useInsertionEffect = noop;
export const useLayoutEffect = noop;
export const useMemo = noop;
export const useOptimistic = noop;
export const useReducer = noop;
export const useRef = noop;
export const useState = noop;
export const useSyncExternalStore = noop;
export const useTransition = noop;
export const unstable_useCacheRefresh = noop;
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  {};
export const __COMPILER_RUNTIME = {};

// react/jsx-runtime
export const jsx = () => null;
export const jsxs = () => null;
export const jsxDEV = () => null;

// react-dom and react-dom/client
export const createPortal = () => null;
export const findDOMNode = noop;
export const createRoot = noop;
export const hydrateRoot = noop;
export const preload = noop;
export const preinit = noop;
export const preconnect = noop;
export const prefetchDNS = noop;
export const preloadModule = noop;
export const preinitModule = noop;
export const requestFormReset = noop;
export const useFormStatus = noop;
export const useFormState = noop;

// `import React from "react"` and `class X extends React.Component`.
export default {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  ViewTransition,
  act,
  addTransitionType,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createPortal,
  createRef,
  createRoot,
  findDOMNode,
  flushSync,
  forwardRef,
  hydrateRoot,
  isValidElement,
  jsx,
  jsxDEV,
  jsxs,
  lazy,
  memo,
  startTransition,
  unstable_batchedUpdates,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
};
