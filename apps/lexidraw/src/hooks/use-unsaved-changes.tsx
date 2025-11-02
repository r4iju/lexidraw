"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import useModal from "~/hooks/useModal";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useAutoSave } from "./use-auto-save";

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
  const skipNextPopConfirmRef = useRef(false);
  const [modal, showModal] = useModal();
  const { enabled: autoSaveEnabled } = useAutoSave();

  const confirm = useCallback(async () => {
    // If auto-save is enabled, automatically save and proceed
    if (autoSaveEnabled) {
      if (onSaveAndLeave) {
        onSaveAndLeave();
      }
      return true;
    }

    // Otherwise, show the modal
    return new Promise<boolean>((resolve) =>
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
    );
  }, [showModal, onSaveAndLeave, autoSaveEnabled]);

  useBeforeUnloadGuard(dirty);

  const shouldSkipNextPop = useCallback(
    () => skipNextPopConfirmRef.current,
    [],
  );
  const clearSkipNextPop = useCallback(() => {
    skipNextPopConfirmRef.current = false;
  }, []);
  const markNextPopAsConfirmed = useCallback(() => {
    skipNextPopConfirmRef.current = true;
  }, []);

  usePopstateGuard(dirty, confirm, shouldSkipNextPop, clearSkipNextPop);

  const guardedRouter = useRouterGuard(dirty, confirm, markNextPopAsConfirmed);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const markPristine = useCallback(() => {
    dirty.current = false;
  }, []);

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
  shouldSkipNextPop: () => boolean,
  clearSkipNextPop: () => void,
) {
  const router = useRouter();

  useLayoutEffect(() => {
    const isRestoringRef = { current: false } as { current: boolean };

    const onPop = async (evt: PopStateEvent) => {
      // If a programmatic back was already confirmed, let it proceed.
      if (shouldSkipNextPop()) {
        clearSkipNextPop();
        return; // do not block; allow Next.js to handle normally
      }

      // Prevent Next.js from handling this pop; we'll decide what to do.
      evt.stopImmediatePropagation();
      evt.stopPropagation();

      // If we're just restoring the previous state (history.go(1)), ignore.
      if (isRestoringRef.current) {
        isRestoringRef.current = false;
        return;
      }

      const shouldLeave = !dirty.current || (await confirm());

      // Always restore to the current entry first so a subsequent back
      // navigates exactly one step (no extra dummy entries, no double back).
      isRestoringRef.current = true;
      history.go(1);

      if (!shouldLeave) {
        // User chose to stay; after history.go(1) we simply remain.
        return;
      }

      // User chose to leave: remove our handler and go back exactly once.
      window.removeEventListener("popstate", onPop, { capture: true });
      // Defer to ensure the history restoration completes before going back.
      setTimeout(() => router.back(), 0);
    };

    window.addEventListener("popstate", onPop, { capture: true });

    return () => {
      window.removeEventListener("popstate", onPop, { capture: true });
    };
  }, [dirty, confirm, router, shouldSkipNextPop, clearSkipNextPop]);
}

function useRouterGuard(
  dirty: React.RefObject<boolean>,
  confirm: () => Promise<boolean>,
  markNextPopAsConfirmed: () => void,
) {
  const router = useRouter();

  const guard = useCallback(
    <T extends (...args: unknown[]) => unknown>(fn: T): T =>
      (async (...args: unknown[]) => {
        if (dirty.current && !(await confirm())) return; // blocked
        if (fn === router.back) markNextPopAsConfirmed();
        return fn(...args);
      }) as unknown as T,
    [dirty, confirm, router.back, markNextPopAsConfirmed],
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

type GuardedLinkProps = ComponentProps<typeof Link>;

export function GuardedLink({ onClick, ...props }: GuardedLinkProps) {
  const {
    router: { push },
  } = useUnsavedChanges();

  const handle: NonNullable<GuardedLinkProps["onClick"]> = (e) => {
    e.preventDefault();
    onClick?.(e);
    push(props.href);
  };

  return <Link {...props} onClick={handle} style={props.style} />;
}
