"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { setLeaveGuard } from "~/lib/leave-guard";
import { useAutoSave } from "./use-auto-save";
import { leaveChoice } from "./leave-choice";
import { OpenEntityContext } from "./use-open-entity-sync";

type Ctx = {
  markDirty(): void;
  markPristine(): void;
  dirty: React.RefObject<boolean>;
};

const UnsavedCtx = createContext<Ctx | null>(null);

/** The question leaving puts, and how the user answers it. */
type Question = {
  savesHeld: boolean;
  answer(choice: "leave" | "save" | "stay"): void;
};

/**
 * Asks before the page leaves an editor with unsaved edits, or with a write
 * made elsewhere still waiting for an answer; see `lib/leave-guard.ts` for
 * the ways out it covers. Edits count as unsaved when the editor marked them
 * dirty or when the open entity holds edits the server does not store.
 * `saveBeforeLeaving` answers whether the save landed.
 */
export function UnsavedChangesProvider({
  children,
  saveBeforeLeaving,
}: {
  children: ReactNode;
  saveBeforeLeaving?: () => Promise<boolean>;
}) {
  const dirty = useRef(false);
  const open = useContext(OpenEntityContext);
  const { enabled: autoSave } = useAutoSave();
  const [question, setQuestion] = useState<Question | null>(null);

  // External system: the app-wide leave guard.
  useEffect(() => {
    const choice = () =>
      leaveChoice({
        unsaved: dirty.current || (open?.sync.hasLocalEdits() ?? false),
        autoSave,
        savesHeld: open?.sync.holdsSaves() ?? false,
      });
    const save = () => saveBeforeLeaving?.() ?? Promise.resolve(true);
    return setLeaveGuard({
      mustAsk: () => choice() !== "leave",
      ask: async () => {
        const decided = choice();
        if (decided === "leave") return true;
        if (decided === "save" && saveBeforeLeaving) return save();
        const savesHeld = open?.sync.holdsSaves() ?? false;
        const answered = await new Promise<"leave" | "save" | "stay">(
          (answer) => setQuestion({ savesHeld, answer }),
        );
        setQuestion(null);
        if (answered !== "save") return answered === "leave";
        // Saving is the user's answer to the write elsewhere: theirs go.
        if (savesHeld) open?.sync.keep();
        return save();
      },
    });
  }, [open, autoSave, saveBeforeLeaving]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const markPristine = useCallback(() => {
    dirty.current = false;
  }, []);

  const value = useMemo<Ctx>(
    () => ({ markDirty, markPristine, dirty }),
    [markDirty, markPristine],
  );

  return (
    <UnsavedCtx.Provider value={value}>
      <Dialog
        open={question !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) question?.answer("stay");
        }}
      >
        <DialogContent className="min-w-80">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {question?.savesHeld
                ? "This changed elsewhere since you opened it, and your edits here are not saved. Saving them will overwrite the other changes. Leave anyway?"
                : "You have unsaved changes. Leave anyway?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => question?.answer("leave")}
            >
              Leave
            </Button>
            {saveBeforeLeaving && (
              <Button
                variant="default"
                onClick={() => question?.answer("save")}
              >
                Save and leave
              </Button>
            )}
            <Button variant="outline" onClick={() => question?.answer("stay")}>
              Stay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
