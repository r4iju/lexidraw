"use client";

import { useCallback, useEffect, useMemo, useState, useId } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import ArticleAudioPlayer from "~/components/audio/ArticleAudioPlayer";
import { AudioPlayer } from "~/components/ui/audio-player";
import { cn } from "~/lib/utils";
import { Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Slider } from "~/components/ui/slider";
import { api } from "~/trpc/react";
import { htmlToPlainText } from "~/lib/html-to-text";
import { labelForLanguage, titleize } from "~/lib/i18n";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  preferredPlaybackRate?: number;
  ttsConfig?: import("~/server/api/routers/config").TtsConfigResult;
};

type TtsSegment = {
  index: number;
  audioUrl: string;
  text: string;
  durationSec?: number;
};

export default function ArticlePreview({
  entity,
  preferredPlaybackRate,
  ttsConfig,
}: Props) {
  const distilled = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as {
        distilled?: {
          title?: string;
          byline?: string | null;
          siteName?: string | null;
          wordCount?: number | null;
          updatedAt?: string;
          contentHtml?: string;
        };
        url?: string;
      };
      return parsed.distilled;
    } catch {
      return undefined;
    }
  }, [entity.elements]);

  const sourceUrl = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
  }, [entity.elements]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [segments, setSegments] = useState<TtsSegment[]>([]);
  const [stitchedUrl, setStitchedUrl] = useState<string | undefined>(undefined);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const uid = useId();

  // Fetch per-user defaults
  const utils = api.useUtils();
  const ttsQuery = api.config.getTtsConfig.useQuery();
  const articleQuery = api.config.getArticleConfig.useQuery();
  const updateTts = api.config.updateTtsConfig.useMutation({
    onSuccess: () => utils.config.getTtsConfig.invalidate(),
  });
  const updateArticle = api.config.updateArticleConfig.useMutation({
    onSuccess: () => utils.config.getArticleConfig.invalidate(),
  });

  // Local config state
  const [ttsCfg, setTtsCfg] = useState({
    provider: "openai" as "openai" | "google" | "kokoro" | "apple_say" | "xtts",
    voiceId: "alloy",
    speed: 1,
    format: "mp3" as "mp3" | "ogg" | "wav",
    languageCode: "en-US",
    sampleRate: undefined as number | undefined,
  });

  // Additional UI filter: optional family provided by catalog
  const [voiceFamily, setVoiceFamily] = useState<string>("all");
  const [articleCfg, setArticleCfg] = useState({
    languageCode: "en-US",
    maxChars: 120000,
    keepQuotes: true,
    autoGenerateAudioOnImport: false,
  });

  useEffect(() => {
    if (ttsQuery.data) {
      setTtsCfg((prev) => ({ ...prev, ...ttsQuery.data }));
    }
  }, [ttsQuery.data]);

  // Live TTS catalog: poll until local providers appear or 30s passes
  const [polling, setPolling] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setPolling(false), 30_000);
    return () => clearTimeout(t);
  }, []);
  const ttsCatalogQuery = api.config.getTtsCatalog.useQuery(undefined, {
    initialData: ttsConfig,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
    refetchInterval: polling ? 3000 : false,
  });
  useEffect(() => {
    const c = ttsCatalogQuery.data;
    const hasLocal = !!c?.providers?.some((p) =>
      ["kokoro", "apple_say", "xtts"].includes(p.id),
    );
    if (hasLocal) setPolling(false);
  }, [ttsCatalogQuery.data]);
  const effectiveCatalog = ttsCatalogQuery.data ?? ttsConfig;

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

  // Families are taken directly from catalog when present

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

  // Reset family when provider or language changes; prefer higher quality
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
      variant = u >= 0 ? id.slice(u + 1) : id; // drop language/gender prefix like bf_
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
  useEffect(() => {
    if (articleQuery.data) {
      setArticleCfg((prev) => ({ ...prev, ...articleQuery.data }));
    }
  }, [articleQuery.data]);

  const savedTts = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as {
        tts?: {
          stitchedUrl?: string;
          segments?: TtsSegment[];
          format?: string;
          updatedAt?: string;
          title?: string;
        };
      };
      return parsed.tts;
    } catch {
      return undefined;
    }
  }, [entity.elements]);

  // Seed from saved TTS if available
  useEffect(() => {
    if (!savedTts) return;
    setStitchedUrl(
      typeof savedTts.stitchedUrl === "string"
        ? savedTts.stitchedUrl
        : undefined,
    );
    setSegments(Array.isArray(savedTts.segments) ? savedTts.segments : []);
  }, [savedTts, savedTts?.stitchedUrl, savedTts?.segments]);

  const handleGenerateAudio = useCallback(async () => {
    if (!sourceUrl) return;
    setIsGenerating(true);
    setTtsError(null);
    try {
      // Derive plain text from already distilled HTML to avoid server refetch
      const distilledHtml = distilled?.contentHtml ?? "";
      const derivedText = distilledHtml ? htmlToPlainText(distilledHtml) : "";
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: sourceUrl,
          text: derivedText,
          provider: ttsCfg.provider,
          voiceId: ttsCfg.voiceId,
          speed: ttsCfg.speed,
          format: ttsCfg.format,
          languageCode: ttsCfg.languageCode,
          title: distilled?.title || entity.title,
          entityId: entity.id,
        }),
      });
      if (resp.status === 202) {
        const queued = (await resp.json()) as {
          id: string;
          manifestUrl: string;
          status: string;
        };
        // Poll manifest until available
        const data = await (async function poll(manifestUrl: string) {
          let delay = 1500;
          const max = 5 * 60_000;
          const start = Date.now();
          for (;;) {
            const r = await fetch(manifestUrl, { cache: "no-store" });
            if (r.ok)
              return (await r.json()) as {
                stitchedUrl?: string;
                segments?: TtsSegment[];
              };
            if (Date.now() - start > max)
              throw new Error("Timed out waiting for audio");
            await new Promise((res) => setTimeout(res, delay));
            delay = Math.min(Math.floor(delay * 1.5), 5000);
          }
        })(queued.manifestUrl);
        setSegments(Array.isArray(data.segments) ? data.segments : []);
        setStitchedUrl(
          typeof data.stitchedUrl === "string" ? data.stitchedUrl : undefined,
        );
      } else if (resp.ok) {
        const json = (await resp.json()) as {
          segments?: TtsSegment[];
          title?: string;
          stitchedUrl?: string;
        };
        setSegments(Array.isArray(json.segments) ? json.segments : []);
        setStitchedUrl(
          typeof json.stitchedUrl === "string" ? json.stitchedUrl : undefined,
        );
      } else {
        const msg = await resp.text();
        throw new Error(msg || "Failed to generate audio");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error generating audio";
      setTtsError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [
    sourceUrl,
    distilled?.title,
    distilled?.contentHtml,
    entity.title,
    entity.id,
    ttsCfg.provider,
    ttsCfg.voiceId,
    ttsCfg.speed,
    ttsCfg.format,
    ttsCfg.languageCode,
  ]);

  // Auto-generate when enabled in user Article settings and not yet generated
  useEffect(() => {
    try {
      const userArticles = (
        typeof window !== "undefined"
          ? // biome-ignore lint/suspicious/noExplicitAny: we do pollute the window object with session user
            (window as any).__SESSION_USER__?.config?.articles
          : undefined
      ) as { autoGenerateAudioOnImport?: boolean } | undefined;
      const shouldAuto = Boolean(userArticles?.autoGenerateAudioOnImport);
      if (
        shouldAuto &&
        sourceUrl &&
        distilled?.contentHtml &&
        !stitchedUrl &&
        segments.length === 0 &&
        !isGenerating &&
        !autoTriggered
      ) {
        setAutoTriggered(true);
        void handleGenerateAudio();
      }
    } catch {
      // ignore
    }
  }, [
    sourceUrl,
    distilled?.contentHtml,
    stitchedUrl,
    segments.length,
    isGenerating,
    autoTriggered,
    handleGenerateAudio,
  ]);

  if (!distilled || !distilled.contentHtml) {
    return null;
  }

  const hasAudio = Boolean(stitchedUrl || (segments?.length ?? 0) > 0);
  let buttonLabel = "Listen";
  if (hasAudio) {
    buttonLabel = "Regenerate audio";
  }
  if (isGenerating && hasAudio) {
    buttonLabel = "Regenerating…";
  } else if (isGenerating) {
    buttonLabel = "Generating…";
  }

  return (
    <div className="w-full space-y-3 md:border-x md:border-border p-4">
      <div className="flex flex-col space-y-2 items-center justify-between">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {distilled.title || entity.title}
          </div>
          <div className="text-muted-foreground text-sm">
            {distilled.byline ? `${distilled.byline} · ` : ""}
            {distilled.siteName || ""}
            {distilled.wordCount ? ` · ${distilled.wordCount} words` : ""}
            {distilled.updatedAt
              ? ` · ${new Date(distilled.updatedAt).toLocaleString()}`
              : ""}
          </div>
        </div>
      </div>
      {ttsError ? (
        <div className="text-sm text-destructive">{ttsError}</div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex w-full justify-end gap-2">
          <Button
            variant="secondary"
            onClick={handleGenerateAudio}
            disabled={!sourceUrl || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {buttonLabel}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Settings</Button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px]">
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium mb-2">Audio (TTS)</div>
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
                          {(ttsConfig?.providers ?? []).map((p) => (
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
                        disabled={false}
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
                        disabled={false}
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
                    {/* notice removed: catalog is authoritative */}
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
                <div>
                  <div className="text-sm font-medium mb-2">Article</div>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Article language removed; synced from TTS Language on save */}
                    <div>
                      <label
                        htmlFor={`${uid}-article-max`}
                        className="block text-xs mb-1"
                      >
                        Max chars
                      </label>
                      <Input
                        id={`${uid}-article-max`}
                        type="number"
                        value={articleCfg.maxChars}
                        onChange={(e) =>
                          setArticleCfg((s) => ({
                            ...s,
                            maxChars: Number(e.target.value || 0),
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={articleCfg.keepQuotes}
                        onCheckedChange={(v) =>
                          setArticleCfg((s) => ({ ...s, keepQuotes: v }))
                        }
                      />
                      <span className="text-xs">Keep quotes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={articleCfg.autoGenerateAudioOnImport}
                        onCheckedChange={(v) =>
                          setArticleCfg((s) => ({
                            ...s,
                            autoGenerateAudioOnImport: v,
                          }))
                        }
                      />
                      <span className="text-xs">Auto-generate on import</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-muted-foreground">
                    Changes apply to future generations. Click Regenerate to
                    apply now.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        updateTts.isPending ||
                        updateArticle.isPending ||
                        isGenerating
                      }
                      onClick={async () => {
                        try {
                          await Promise.all([
                            updateTts.mutateAsync({
                              provider: ttsCfg.provider,
                              voiceId: ttsCfg.voiceId,
                              speed: ttsCfg.speed,
                              format: ttsCfg.format,
                              languageCode: ttsCfg.languageCode,
                              sampleRate: ttsCfg.sampleRate,
                            }),
                            updateArticle.mutateAsync({
                              languageCode: ttsCfg.languageCode,
                              maxChars: articleCfg.maxChars,
                              keepQuotes: articleCfg.keepQuotes,
                              autoGenerateAudioOnImport:
                                articleCfg.autoGenerateAudioOnImport,
                            }),
                          ]);
                        } catch (_e) {
                          // noop: error surfaced by tRPC hook
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {stitchedUrl ? (
          <div>
            <AudioPlayer
              src={stitchedUrl}
              initialPlaybackRate={preferredPlaybackRate}
              autoPlay
            />
          </div>
        ) : segments.length ? (
          <div>
            <ArticleAudioPlayer
              segments={segments}
              preferredPlaybackRate={preferredPlaybackRate}
            />
          </div>
        ) : null}
      </div>
      <div
        className={cn("prose max-w-none dark:prose-invert ")}
        data-prose="scoped"
      >
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized on the server before persisting
          dangerouslySetInnerHTML={{ __html: distilled.contentHtml ?? "" }}
        />
      </div>
      <style>{`
        /* Scoped to this instance only */
        [data-prose="scoped"] pre {
          max-width: 100%;
          overflow-x: auto;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        [data-prose="scoped"] pre code {
          white-space: inherit;
          display: block;
        }
        [data-prose="scoped"] code {
          overflow-wrap: anywhere;
          word-break: break-word;
        }
      `}</style>
    </div>
  );
}
