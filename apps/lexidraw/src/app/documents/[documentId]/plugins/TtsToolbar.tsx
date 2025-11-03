"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useId,
  useRef,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent } from "~/components/ui/popover";
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
import { ChevronDown, Loader2, Settings, Volume2, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useMarkdownTools } from "../utils/markdown";
import { PlayFromHereButton } from "./PlayFromHereButton";
import { labelForLanguage, titleize } from "~/lib/i18n";
import { useEntityId } from "~/hooks/use-entity-id";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { PopoverAnchor, PopoverClose } from "@radix-ui/react-popover";

type Props = {
  className?: string;
};

export function TtsToolbar({ className }: Props) {
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
      toast.success("TTS settings saved");
    },
  });
  const ttsCatalogQuery = api.config.getTtsCatalog.useQuery(undefined, {
    refetchOnMount: true,
    staleTime: 0,
  });

  // Check if audio already exists
  const ttsStatusQuery = api.tts.getDocumentTtsStatus.useQuery(
    { documentId },
    { refetchOnMount: true },
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
  const lastOpened = useRef<number | null>(null);

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

  return (
    <fieldset className={cn("flex", className)} aria-label="TTS controls">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="w-14 md:w-12 h-12 md:h-10 rounded-r-none border-r-0"
            title="Generate audio"
          >
            TTS
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={handleGenerateAudio}
            className="flex items-center gap-2 justify-between"
          >
            <span className="text-md">
              {ttsStatusQuery.data?.status === "ready"
                ? "Regenerate audio"
                : "Generate audio"}
            </span>
            {isGeneratingAudio ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-2 justify-between"
            onSelect={() => {
              lastOpened.current = Date.now();
              setSettingsOpen(true);
            }}
          >
            <span className="text-md">Settings</span>
            <Settings className="h-4 w-4" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={settingsOpen} onOpenChange={setSettingsOpen} modal={false}>
        <PopoverAnchor></PopoverAnchor>
        <PopoverContent
          className="w-[380px] max-w-[90vw] absolute top-5 right-0"
          onInteractOutside={(e) => {
            if (lastOpened.current && Date.now() - lastOpened.current < 100) {
              e.preventDefault();
              return;
            }
            setSettingsOpen(false);
          }}
        >
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Audio (TTS)</div>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </PopoverClose>
              <div className="grid grid-cols-2 gap-3">
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
                  <label
                    htmlFor={`${uid}-tts-lang`}
                    className="block text-xs mb-1"
                  >
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
                    onValueChange={(v) =>
                      setTtsCfg((s) => ({ ...s, voiceId: v }))
                    }
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
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="text-xs text-muted-foreground">
                Changes apply to future generations.
              </div>
              <Button
                size="sm"
                onClick={handleSaveSettings}
                disabled={updateTts.isPending}
              >
                {updateTts.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <PlayFromHereButton
        documentId={documentId}
        buttonClassName="w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0 border-x rounded-r-md"
      />
    </fieldset>
  );
}
