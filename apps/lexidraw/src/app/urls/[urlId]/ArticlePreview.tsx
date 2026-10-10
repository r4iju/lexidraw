"use client";

import { useMemo } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { LocalTime } from "~/components/ui/local-time";
import { parseLinkElements } from "./link-elements";
import ArticleAudioPlayer from "~/components/audio/ArticleAudioPlayer";
import { AudioPlayer } from "~/components/ui/audio-player";
import { cn } from "~/lib/utils";
import { Settings } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { toast } from "sonner";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  preferredPlaybackRate?: number;
  ttsConfig?: import("~/server/api/routers/config").TtsConfigResult;
  /** Generating audio needs an account; saved audio plays for anyone. */
  canGenerateAudio: boolean;
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
  canGenerateAudio,
}: Props) {
  const { distilled, url: sourceUrl } = useMemo(
    () => parseLinkElements(entity.elements),
    [entity.elements],
  );

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

  const stitchedUrl =
    typeof savedTts?.stitchedUrl === "string"
      ? savedTts.stitchedUrl
      : undefined;
  const segments = Array.isArray(savedTts?.segments) ? savedTts.segments : [];

  function handleGenerateAudio() {
    toast.message(
      "Legacy article narration is unavailable. Saved recordings remain available. Manage AI Power for supported document narration.",
    );
  }

  if (!distilled?.contentHtml) {
    return null;
  }

  return (
    <div className="w-full space-y-3 md:border-x md:border-border p-4">
      <div className="flex flex-col items-center justify-between">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {distilled.title || entity.title}
          </div>
          <div className="text-muted-foreground text-sm">
            {distilled.byline ? `${distilled.byline} · ` : ""}
            {distilled.siteName || ""}
            {distilled.wordCount ? ` · ${distilled.wordCount} words` : ""}
            {distilled.updatedAt ? (
              <>
                {" · "}
                <LocalTime value={distilled.updatedAt} />
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {canGenerateAudio && (
          <div className="flex w-full justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleGenerateAudio}
              disabled={!sourceUrl}
            >
              New narration unavailable
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="outline">
                  <Settings className="size-4" />
                  <span className="sr-only">Audio settings</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <p>
                  Legacy article voice services are unavailable. Saved
                  recordings remain available. Use AI Power for supported
                  document narration.
                </p>
                <a href="/settings#settings-ai-power">
                  Manage AI Power and playback speed
                </a>
              </PopoverContent>
            </Popover>
          </div>
        )}
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
              making={false}
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
