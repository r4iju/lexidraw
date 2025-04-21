import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import useModal from "~/hooks/useModal";

type UnsavedChangesContextType = {
  markDirty: () => void;
  markPristine: () => void;
  dirty: React.RefObject<boolean>;
};

const UnsavedChangesContext = createContext<
  UnsavedChangesContextType | undefined
>(undefined);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const [modal, showModal] = useModal();

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        showModal("Unsaved changes", (onClose) => (
          <div className="flex flex-col gap-4">
            <p>You have unsaved changes. Leave anyway?</p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="destructive"
                onClick={() => {
                  onClose();
                  resolve(true);
                }}
              >
                Leave
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  resolve(false);
                }}
              >
                Stay
              </Button>
            </div>
          </div>
        ));
      }),
    [showModal],
  );

  // Keep askRef up to date
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const markPristine = useCallback(() => {
    dirty.current = false;
  }, []);

  // beforeunload for hard unloads
  useEffect(() => {
    const handle = (evt: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      evt.preventDefault();
      evt.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handle, { capture: true });
    return () =>
      window.removeEventListener("beforeunload", handle, { capture: true });
  }, []);

  // popstate for back/forward
  useEffect(() => {
    const MARKER = `__guard_${Date.now()}`;
    history.pushState({ __dummy: true }, "");
    history.replaceState({ ...(history.state ?? {}), [MARKER]: true }, "");

    const onPopState = async (evt: PopStateEvent) => {
      if (!evt.state?.[MARKER]) return;
      if (dirty.current) {
        const shouldLeave = await askRef.current();
        if (!shouldLeave) {
          history.pushState(
            { ...(history.state ?? {}), [MARKER]: true },
            "",
            location.href,
          );
          return;
        }
      }
      window.removeEventListener("popstate", onPopState);
      history.back();
    };
    window.addEventListener("popstate", onPopState, { capture: true });
    return () =>
      window.removeEventListener("popstate", onPopState, { capture: true });
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ markDirty, markPristine, dirty }}>
      {modal}
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx)
    throw new Error(
      "useUnsavedChanges must be used within UnsavedChangesProvider",
    );
  return ctx;
}
