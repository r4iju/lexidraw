"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Headphones, Loader2, Play, Settings, Volume2 } from "lucide-react";
import { api } from "~/trpc/react";
import { ListenPlayer } from "./ListenPlayer";
import { useEntityId } from "~/hooks/use-entity-id";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { ToolbarMenu, ToolbarTooltip } from "./ToolbarPlugin/toolbar";

type Listen = {
  documentId: string;
  ready: boolean;
  generating: boolean;
  generate: () => void;
  openSettings: () => void;
  playerOpen: boolean;
  setPlayerOpen: (open: boolean) => void;
  /** The control the player opens beside, while one is showing. */
  setPlayerAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
};

const ListenContext = createContext<Listen | null>(null);

function useListen() {
  const listen = useContext(ListenContext);
  if (!listen) throw new Error("useListen must be inside ListenProvider");
  return listen;
}

/**
 * Read-aloud, and its one player: the toolbar, its More menu and the reading
 * pill only open and close it.
 */
export function ListenProvider({ children }: { children: ReactNode }) {
  const documentId = useEntityId();
  // Check if audio already exists
  const ttsStatusQuery = api.tts.getDocumentTtsStatus.useQuery(
    { documentId },
    {
      refetchOnMount: true,
      refetchOnWindowFocus: (query) => {
        const status = query.state.data?.status;
        // Only refetch on focus when job is actively processing
        return status === "queued" || status === "processing";
      },
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        // Only poll when job is actively processing
        if (status === "queued" || status === "processing") {
          return 2000; // Poll every 2 seconds
        }
        // Stop polling for terminal states or when no job exists
        return false;
      },
    },
  );

  const isGeneratingAudio = false;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerAnchor, setPlayerAnchor] = useState<HTMLElement | null>(null);

  const ready = ttsStatusQuery.data?.status === "ready";
  const listen = useMemo(
    (): Listen => ({
      documentId,
      ready,
      generating: isGeneratingAudio,
      generate: () => setSettingsOpen(true),
      openSettings: () => setSettingsOpen(true),
      playerOpen,
      setPlayerOpen,
      setPlayerAnchor,
    }),
    [documentId, ready, playerOpen],
  );

  return (
    <ListenContext.Provider value={listen}>
      {children}
      <ListenPlayer
        documentId={documentId}
        open={playerOpen}
        onOpenChange={setPlayerOpen}
        anchor={playerAnchor}
      />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Listen settings</DialogTitle>
          </DialogHeader>
          <p>
            New narration follows your account AI Power preference. Legacy voice
            services are unavailable. Saved recordings remain available.
          </p>
          <a href="/settings#settings-ai-power">
            Manage AI Power and playback speed
          </a>

          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </ListenContext.Provider>
  );
}

/** Listen's actions as menu items; `withPlay` adds playing, for More. */
export function ListenItems({ withPlay = false }: { withPlay?: boolean }) {
  const { generating, generate, openSettings, setPlayerOpen } = useListen();
  return (
    <>
      {withPlay && (
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => setPlayerOpen(true)}
        >
          <Play className="size-4" />
          Play from cursor
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="gap-2"
        onSelect={generate}
        disabled={generating}
      >
        {generating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Volume2 className="size-4" />
        )}
        New narration unavailable
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2" onSelect={openSettings}>
        <Settings className="size-4" />
        Listen settings…
      </DropdownMenuItem>
    </>
  );
}

export function ListenControls() {
  return (
    <>
      <ToolbarMenu label="Listen" icon={Headphones} trigger="Listen">
        <ListenItems />
      </ToolbarMenu>
      <PlayFromCursor />
    </>
  );
}

/** Opens and closes the player, which opens beside it while it shows. */
function PlayFromCursor() {
  const { playerOpen, setPlayerOpen, setPlayerAnchor } = useListen();
  const anchor = useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button) return;
      setPlayerAnchor(button);
      return () =>
        setPlayerAnchor((anchor) => (anchor === button ? null : anchor));
    },
    [setPlayerAnchor],
  );
  return (
    <ToolbarTooltip label="Play from cursor">
      <Button
        ref={anchor}
        size="icon"
        variant="ghost"
        aria-label="Play from cursor"
        aria-haspopup="dialog"
        aria-expanded={playerOpen}
        onClick={() => setPlayerOpen(!playerOpen)}
        className="size-8 shrink-0 pointer-coarse:size-11"
      >
        <Play />
      </Button>
    </ToolbarTooltip>
  );
}
