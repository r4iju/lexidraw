"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import useModal from "~/hooks/useModal";
import Link, { LinkProps } from "next/link";
import { MouseEvent } from "react";

type Ctx = {
  markDirty(): void;
  markPristine(): void;
  dirty: React.RefObject<boolean>;
  router: ReturnType<typeof useRouterGuard>;
};

const UnsavedCtx = createContext<Ctx | null>(null);

export function UnsavedChangesProvider({
  children,
  onSaveAndLeave,
}: {
  children: ReactNode;
  onSaveAndLeave?: () => void;
}) {
  const dirty = useRef(false);
  const [modal, showModal] = useModal();

  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) =>
        showModal("Unsaved changes", (close) => (
          <div className="flex flex-col gap-4">
            <p>You have unsaved changes. Leave anyway?</p>
            <div className="flex gap-2 self-end">
              <Button
                variant="destructive"
                onClick={() => {
                  close();
                  resolve(true);
                }}
              >
                Leave
              </Button>
              {onSaveAndLeave && (
                <Button
                  variant="default"
                  onClick={() => {
                    close();
                    onSaveAndLeave();
                  }}
                >
                  Save and leave
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  close();
                  resolve(false);
                }}
              >
                Stay
              </Button>
            </div>
          </div>
        )),
      ),
    [showModal, onSaveAndLeave],
  );

  useBeforeUnloadGuard(dirty);
  usePopstateGuard(dirty, confirm);

  const guardedRouter = useRouterGuard(dirty, confirm);

  const markDirty = useCallback(() => (dirty.current = true), []);
  const markPristine = useCallback(() => (dirty.current = false), []);

  const value = useMemo<Ctx>(
    () => ({
      markDirty,
      markPristine,
      dirty,
      router: guardedRouter,
    }),
    [guardedRouter, markDirty, markPristine],
  );

  return (
    <UnsavedCtx.Provider value={value}>
      {modal}
      {children}
    </UnsavedCtx.Provider>
  );
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedCtx);
  if (!ctx) {
    throw new Error("useUnsavedChanges must be inside UnsavedChangesProvider");
  }
  return ctx;
}

function useBeforeUnloadGuard(dirty: React.RefObject<boolean>) {
  useLayoutEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty]);
}

function usePopstateGuard(
  dirty: React.RefObject<boolean>,
  confirm: () => Promise<boolean>,
) {
  const router = useRouter();

  useLayoutEffect(() => {
    const KEY = `__guard_${Date.now()}`;

    history.pushState({}, "");
    history.replaceState({ ...(history.state ?? {}), [KEY]: true }, "");

    const onPop = async (evt: PopStateEvent) => {
      evt.stopImmediatePropagation();

      if (dirty.current && !(await confirm())) {
        history.pushState(
          { ...(history.state ?? {}), [KEY]: true },
          "",
          location.href,
        );

        return;
      }

      window.removeEventListener("popstate", onPop);

      // silly but it works
      router.back();
      // router.back();
    };

    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, [dirty, confirm, router]);
}

function useRouterGuard(
  dirty: React.RefObject<boolean>,
  confirm: () => Promise<boolean>,
) {
  const router = useRouter();

  const guard = useCallback(
    <T extends (...args: unknown[]) => unknown>(fn: T): T =>
      (async (...args: unknown[]) => {
        if (dirty.current && !(await confirm())) return; // blocked
        return fn(...args);
      }) as unknown as T,
    [dirty, confirm],
  );

  return useMemo(
    () => ({
      ...router,
      // @ts-expect-error: Next.js router method signatures are not compatible with (...args: unknown[]) => unknown
      push: guard(router.push),
      // @ts-expect-error: Next.js router method signatures are not compatible with (...args: unknown[]) => unknown
      replace: guard(router.replace),
      back: guard(router.back),
      forward: guard(router.forward),
      refresh: guard(router.refresh),
    }),
    [router, guard],
  );
}

export function GuardedLink({
  onClick,
  ...props
}: LinkProps & {
  children: ReactNode;
  onClick?: (e: MouseEvent) => void;
  style?: React.CSSProperties;
}) {
  const {
    router: { push },
  } = useUnsavedChanges();

  const handle = (e: MouseEvent) => {
    e.preventDefault();
    onClick?.(e);
    push(props.href);
  };

  return <Link {...props} onClick={handle} style={props.style} />;
}
