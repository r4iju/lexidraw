"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useId,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Slider } from "~/components/ui/slider";
import { Progress } from "~/components/ui/progress";
import { Headphones, Loader2, Play, Settings, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useMarkdownTools } from "../utils/markdown";
import { ListenPlayer } from "./ListenPlayer";
import { labelForLanguage, titleize } from "~/lib/i18n";
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
  const [editor] = useLexicalComposerContext();
  const { convertEditorStateToMarkdown } = useMarkdownTools();
  const uid = useId();
  const utils = api.useUtils();

  // TTS config state
  const ttsQuery = api.config.getTtsConfig.useQuery();
  const updateTts = api.config.updateTtsConfig.useMutation({
    onSuccess: () => {
      utils.config.getTtsConfig.invalidate();
      toast.success("Listen settings saved");
    },
  });
  const ttsCatalogQuery = api.config.getTtsCatalog.useQuery(undefined, {
    refetchOnMount: true,
    staleTime: 0,
  });

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

  const [ttsCfg, setTtsCfg] = useState({
    provider: "openai" as "openai" | "google" | "kokoro" | "apple_say" | "xtts",
    voiceId: "alloy",
    speed: 1,
    format: "mp3" as "mp3" | "ogg" | "wav",
    languageCode: "en-US",
    sampleRate: undefined as number | undefined,
  });

  const [voiceFamily, setVoiceFamily] = useState<string>("all");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerAnchor, setPlayerAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (ttsQuery.data) {
      setTtsCfg((prev) => ({ ...prev, ...ttsQuery.data }));
    }
  }, [ttsQuery.data]);

  const effectiveCatalog = ttsCatalogQuery.data;

  // Auto-select defaults when provider changes or catalog updates
  useEffect(() => {
    const allVoices = (effectiveCatalog?.voices ?? []) as Array<
      import("~/server/api/routers/config").TtsConfigVoice
    >;
    const prov = ttsCfg.provider;
    const filtered = allVoices.filter((v) => v.provider === prov);
    const langs = new Set<string>();
    for (const v of filtered)
      for (const lc of v.languageCodes || []) langs.add(lc);
    setTtsCfg((prev) => {
      let next = prev;
      const langList = Array.from(langs);
      if (langList.length > 0 && !langList.includes(prev.languageCode)) {
        next = { ...next, languageCode: langList[0] as string };
      }
      const voicesForLang = filtered.filter((v) =>
        (v.languageCodes || []).includes(next.languageCode || ""),
      );
      if (voicesForLang.length > 0) {
        const firstId = voicesForLang[0]?.id as string | undefined;
        if (
          firstId &&
          !voicesForLang.some((v) => v.id === (next.voiceId || ""))
        ) {
          next = { ...next, voiceId: firstId };
        }
      }
      return next;
    });
  }, [effectiveCatalog, ttsCfg.provider]);

  // Filter voices by selected language for the voice dropdown
  const filteredVoices = useMemo(() => {
    const all = (
      (effectiveCatalog?.voices ?? []) as Array<
        import("~/server/api/routers/config").TtsConfigVoice
      >
    ).filter((v) => v.provider === ttsCfg.provider);
    const lang = ttsCfg.languageCode;
    const byLang = lang
      ? all.filter((v) => (v.languageCodes ?? []).includes(lang))
      : all;
    if (voiceFamily === "all") return byLang;
    return byLang.filter(
      (v) => (v as { family?: string }).family === voiceFamily,
    );
  }, [effectiveCatalog, ttsCfg.provider, ttsCfg.languageCode, voiceFamily]);

  // Derive available families from language-filtered voices
  const availableFamilies = useMemo(() => {
    const all = (
      (effectiveCatalog?.voices ?? []) as Array<
        import("~/server/api/routers/config").TtsConfigVoice
      >
    ).filter((v) => v.provider === ttsCfg.provider);
    const lang = ttsCfg.languageCode;
    const byLang = lang
      ? all.filter((v) => (v.languageCodes ?? []).includes(lang))
      : all;
    const fams = new Set<string>();
    for (const v of byLang) {
      const fam = (v as { family?: string }).family;
      if (fam) fams.add(fam);
    }
    return Array.from(fams);
  }, [effectiveCatalog, ttsCfg.provider, ttsCfg.languageCode]);

  const catalogLanguages = useMemo((): string[] => {
    const list = (
      (effectiveCatalog?.voices ?? []) as Array<
        import("~/server/api/routers/config").TtsConfigVoice
      >
    )
      .filter((v) => v.provider === ttsCfg.provider)
      .flatMap((v) => v.languageCodes || []);
    const fromVoices = Array.from(new Set(list));
    if (fromVoices.length > 0) return fromVoices;
    const prov = (effectiveCatalog?.providers ?? []).find(
      (p) => p.id === ttsCfg.provider,
    );
    return Array.from(new Set((prov?.languages ?? []).map((c) => c)));
  }, [effectiveCatalog, ttsCfg.provider]);

  // Ensure selected voice remains valid for the selected language
  useEffect(() => {
    setTtsCfg((prev) => {
      if (filteredVoices.length === 0) return prev;
      if (!filteredVoices.some((v) => v.id === prev.voiceId)) {
        return { ...prev, voiceId: filteredVoices[0]?.id ?? prev.voiceId };
      }
      return prev;
    });
  }, [filteredVoices]);

  // Reset family when provider or language changes
  useEffect(() => {
    if (ttsCfg.provider === "openai") {
      setVoiceFamily("all");
      return;
    }
    const prefs = [
      "Chirp3-HD",
      "Chirp3",
      "Chirp2",
      "Chirp",
      "Neural2",
      "WaveNet",
      "Standard",
    ];
    if (voiceFamily !== "all" && availableFamilies.includes(voiceFamily))
      return;
    for (const p of prefs) {
      if (availableFamilies.includes(p)) {
        setVoiceFamily(p);
        return;
      }
    }
    setVoiceFamily("all");
  }, [ttsCfg.provider, availableFamilies, voiceFamily]);

  function renderVoiceLabel(id: string, label: string): string {
    if (ttsCfg.provider === "openai") return label;
    const genderMatch = label.match(/\(([^)]+)\)\s*$/);
    const gender: string = genderMatch?.[1] ?? "";
    let variant = id;
    if (ttsCfg.provider === "kokoro") {
      const u = id.indexOf("_");
      variant = u >= 0 ? id.slice(u + 1) : id;
    } else {
      const parts = id.split("-");
      const last = parts.length >= 1 ? parts[parts.length - 1] : undefined;
      variant = typeof last === "string" && last ? last : id;
    }
    variant = variant.replace(/_/g, " ");
    variant = variant.charAt(0).toUpperCase() + variant.slice(1);
    const prettyGender = gender
      ? gender.charAt(0) + gender.slice(1).toLowerCase()
      : "";
    return prettyGender ? `${variant} (${prettyGender})` : variant;
  }

  const startTts = api.tts.startDocumentTts.useMutation();
  const deleteTts = api.tts.deleteDocumentTts.useMutation();

  const handleGenerateAudio = useCallback(async () => {
    setIsGeneratingAudio(true);
    const toastId = `tts-${documentId}-${Date.now()}`;
    try {
      const editorState = editor.getEditorState();
      const markdown = convertEditorStateToMarkdown(editorState);

      if (!markdown.trim()) {
        toast.error("Document is empty");
        setIsGeneratingAudio(false);
        return;
      }

      // Check if regenerating (audio already exists)
      const isRegenerating = ttsStatusQuery.data?.status === "ready";
      if (isRegenerating) {
        // Delete old audio files before regenerating
        await deleteTts.mutateAsync({ documentId });
        // Invalidate status query to refresh
        await utils.tts.getDocumentTtsStatus.invalidate({ documentId });
      }

      await startTts.mutateAsync({
        documentId,
        markdown,
        provider: ttsCfg.provider,
        voiceId: ttsCfg.voiceId,
        speed: ttsCfg.speed,
        format: ttsCfg.format,
        languageCode: ttsCfg.languageCode,
        sampleRate: ttsCfg.sampleRate,
      });

      // Show initial loading toast
      toast.loading(
        <div className="flex flex-col gap-2 w-full min-w-[300px]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Generating audio...</span>
            <span className="text-xs text-muted-foreground">0/? segments</span>
          </div>
          <Progress value={0} className="h-2" />
        </div>,
        { id: toastId, duration: Infinity },
      );

      // Poll status via tRPC utils
      let delay = 1000;
      const max = 60_000;
      const startTime = Date.now();
      for (;;) {
        const snap = await utils.tts.getDocumentTtsStatus.fetch({
          documentId,
        });
        if (!snap) {
          break;
        }

        const completedSegments = snap.segmentCount ?? 0;
        const totalSegments = snap.plannedCount ?? snap.segmentCount ?? 1;
        const progress =
          totalSegments > 0 ? (completedSegments / totalSegments) * 100 : 0;

        if (snap.status === "ready") {
          // Use segmentCount from status response, which is already set when ready
          const finalCount = snap.segmentCount ?? 0;
          toast.success(
            <div className="flex flex-col gap-2 w-full min-w-[300px]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Audio generated successfully
                </span>
                <span className="text-xs text-muted-foreground">
                  {finalCount} segments
                </span>
              </div>
              <Progress value={100} className="h-2" />
            </div>,
            { id: toastId },
          );
          break;
        }

        if (snap.status === "error") {
          toast.error(snap.error || "Error generating audio", { id: toastId });
          break;
        }

        // Update progress toast
        const statusLabel =
          snap.status === "queued"
            ? "queued"
            : snap.status === "processing"
              ? "processing"
              : "";
        toast.loading(
          <div className="flex flex-col gap-2 w-full min-w-[300px]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Generating audio...
                {statusLabel ? ` (${statusLabel})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {completedSegments}/{totalSegments} segments
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>,
          { id: toastId, duration: Infinity },
        );

        if (Date.now() - startTime > max) {
          toast.message("Audio generation queued. It will appear shortly.", {
            id: toastId,
          });
          break;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay + 500, 2500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error generating audio";
      toast.error(msg, { id: toastId });
    } finally {
      setIsGeneratingAudio(false);
    }
  }, [
    editor,
    convertEditorStateToMarkdown,
    documentId,
    startTts,
    deleteTts,
    ttsCfg,
    ttsStatusQuery.data?.status,
    utils.tts.getDocumentTtsStatus,
  ]);

  const handleSaveSettings = useCallback(() => {
    updateTts.mutate({
      provider: ttsCfg.provider,
      voiceId: ttsCfg.voiceId,
      speed: ttsCfg.speed,
      format: ttsCfg.format,
      languageCode: ttsCfg.languageCode,
      sampleRate: ttsCfg.sampleRate,
    });
  }, [updateTts, ttsCfg]);

  const ready = ttsStatusQuery.data?.status === "ready";
  const listen = useMemo(
    (): Listen => ({
      documentId,
      ready,
      generating: isGeneratingAudio,
      generate: () => void handleGenerateAudio(),
      openSettings: () => setSettingsOpen(true),
      playerOpen,
      setPlayerOpen,
      setPlayerAnchor,
    }),
    [documentId, ready, isGeneratingAudio, handleGenerateAudio, playerOpen],
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
          <form
            id={`${uid}-tts-settings`}
            className="grid grid-cols-2 gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveSettings();
            }}
          >
            <div>
              <label
                htmlFor={`${uid}-tts-provider`}
                className="block text-xs mb-1"
              >
                Provider
              </label>
              <Select
                name={`${uid}-tts-provider`}
                value={ttsCfg.provider}
                onValueChange={(v) =>
                  setTtsCfg((s) => ({
                    ...s,
                    provider: v as typeof s.provider,
                  }))
                }
              >
                <SelectTrigger id={`${uid}-tts-provider`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(effectiveCatalog?.providers ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label || p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor={`${uid}-tts-lang`} className="block text-xs mb-1">
                Language
              </label>
              <Select
                name={`${uid}-tts-lang`}
                value={ttsCfg.languageCode}
                onValueChange={(v) =>
                  setTtsCfg((s) => ({ ...s, languageCode: v }))
                }
              >
                <SelectTrigger id={`${uid}-tts-lang`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalogLanguages.map((lc) => (
                    <SelectItem key={lc} value={lc}>
                      {labelForLanguage(lc)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor={`${uid}-tts-family`}
                className="block text-xs mb-1"
              >
                Voice family
              </label>
              <Select
                name={`${uid}-tts-family`}
                value={voiceFamily}
                onValueChange={(v) => setVoiceFamily(v)}
              >
                <SelectTrigger id={`${uid}-tts-family`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {availableFamilies.map((fam) => (
                    <SelectItem key={fam} value={fam}>
                      {titleize(fam)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor={`${uid}-tts-voice`}
                className="block text-xs mb-1"
              >
                Voice ID
              </label>
              <Select
                name={`${uid}-tts-voice`}
                value={ttsCfg.voiceId}
                onValueChange={(v) => setTtsCfg((s) => ({ ...s, voiceId: v }))}
                disabled={filteredVoices.length === 0}
              >
                <SelectTrigger id={`${uid}-tts-voice`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filteredVoices.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {renderVoiceLabel(v.id, v.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label
                htmlFor={`${uid}-tts-speed`}
                className="block text-xs mb-2"
              >
                Speed ({ttsCfg.speed.toFixed(2)})
              </label>
              <Slider
                id={`${uid}-tts-speed`}
                min={0.25}
                max={4}
                step={0.05}
                value={[ttsCfg.speed]}
                onValueChange={([v]) =>
                  setTtsCfg((s) => ({ ...s, speed: v ?? s.speed }))
                }
              />
            </div>
            <div>
              <label
                htmlFor={`${uid}-tts-format`}
                className="block text-xs mb-1"
              >
                Format
              </label>
              <Select
                name={`${uid}-tts-format`}
                value={ttsCfg.format}
                onValueChange={(v) =>
                  setTtsCfg((s) => ({
                    ...s,
                    format: v as typeof s.format,
                  }))
                }
              >
                <SelectTrigger id={`${uid}-tts-format`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp3">MP3</SelectItem>
                  <SelectItem value="ogg">OGG</SelectItem>
                  <SelectItem value="wav">WAV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor={`${uid}-tts-sample`}
                className="block text-xs mb-1"
              >
                Sample rate
              </label>
              <Input
                id={`${uid}-tts-sample`}
                type="number"
                value={ttsCfg.sampleRate ?? ""}
                onChange={(e) =>
                  setTtsCfg((s) => ({
                    ...s,
                    sampleRate: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
            </div>
          </form>
          <DialogFooter>
            <p className="text-xs text-muted-foreground sm:mr-auto">
              Changes apply to audio generated from now on.
            </p>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              form={`${uid}-tts-settings`}
              disabled={updateTts.isPending}
            >
              {updateTts.isPending ? "Saving…" : "Save settings"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListenContext.Provider>
  );
}

/** Listen's actions as menu items; `withPlay` adds playing, for More. */
export function ListenItems({ withPlay = false }: { withPlay?: boolean }) {
  const { ready, generating, generate, openSettings, setPlayerOpen } =
    useListen();
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
        {ready ? "Regenerate audio" : "Generate audio"}
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
