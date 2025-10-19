"use client";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { AudioPlayer } from "~/components/ui/audio-player";
import { cn } from "~/lib/utils";
import { Label } from "../ui/label";

type Segment = {
  index: number;
  audioUrl: string;
  text: string;
  durationSec?: number;
};

type Props = {
  segments: Segment[];
  preferredPlaybackRate?: number;
};

export default function ArticleAudioPlayer({
  segments,
  preferredPlaybackRate,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = useMemo(
    () => segments[currentIndex],
    [segments, currentIndex],
  );

  if (!segments.length) return null;

  return (
    <div className="space-y-2">
      <AudioPlayer
        src={current?.audioUrl ?? ""}
        autoPlay
        initialPlaybackRate={preferredPlaybackRate}
        onEnded={() => {
          if (currentIndex < segments.length - 1)
            setCurrentIndex(currentIndex + 1);
        }}
      />
      <Label htmlFor="Segment">Segments</Label>
      <div className="flex flex-wrap gap-0 items-center">
        {segments.map((s, i) => (
          <Button
            size="sm"
            key={s.index}
            onClick={() => setCurrentIndex(i)}
            variant={i === currentIndex ? "default" : "outline"}
            className={cn("", {
              "rounded-r-none": i === 0,
              "rounded-l-none": i === segments.length - 1,
              "rounded-none": i !== 0 && i !== segments.length - 1,
              "px-4": i === currentIndex,
            })}
          >
            {i + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}
