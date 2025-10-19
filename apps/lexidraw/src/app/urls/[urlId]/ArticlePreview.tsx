"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import ArticleAudioPlayer from "~/components/audio/ArticleAudioPlayer";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  preferredPlaybackRate?: number;
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
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: sourceUrl,
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
  }, [sourceUrl, distilled?.title, entity.title, entity.id]);

  if (!distilled || !distilled.contentHtml) {
    return null;
  }

  return (
    <div className="w-full space-y-3 md:border-x md:border-border p-4">
      <div className="flex items-center justify-between">
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleGenerateAudio}
            disabled={!sourceUrl || isGenerating}
          >
            {stitchedUrl || segments.length
              ? "Regenerate audio"
              : isGenerating
                ? "Generating…"
                : "Listen"}
          </Button>
        </div>
      </div>
      {ttsError ? (
        <div className="text-sm text-destructive">{ttsError}</div>
      ) : null}
      {stitchedUrl ? (
        <div>
          <audio controls className="w-full" src={stitchedUrl}>
            <track kind="captions" srcLang="en" label="" />
          </audio>
        </div>
      ) : segments.length ? (
        <div>
          <ArticleAudioPlayer
            title={savedTts?.title || distilled.title || entity.title}
            segments={segments}
            preferredPlaybackRate={preferredPlaybackRate}
          />
        </div>
      ) : null}
      <div className="prose max-w-none dark:prose-invert">
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized on the server before persisting
          dangerouslySetInnerHTML={{ __html: distilled.contentHtml ?? "" }}
        />
      </div>
    </div>
  );
}
