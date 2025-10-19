"use client";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type Segment = {
  index: number;
  audioUrl: string;
  text: string;
  durationSec?: number;
};

type Props = {
  title?: string;
  segments: Segment[];
};

export default function ArticleAudioPlayer({ title, segments }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = useMemo(
    () => segments[currentIndex],
    [segments, currentIndex],
  );

  if (!segments.length) return null;

  return (
    <div className="space-y-2">
      {title ? <h3 className="text-base font-medium">{title}</h3> : null}
      <audio
        key={current?.index}
        src={current?.audioUrl}
        controls
        autoPlay
        preload="auto"
        playsInline
        className="w-full"
        onEnded={() => {
          if (currentIndex < segments.length - 1)
            setCurrentIndex(currentIndex + 1);
        }}
      >
        <track kind="captions" srcLang="en" label="" />
      </audio>
      <div className="flex flex-wrap gap-0">
        {segments.map((s, i) => (
          <Button
            key={s.index}
            onClick={() => setCurrentIndex(i)}
            variant={i === currentIndex ? "default" : "outline"}
            title={s.text.slice(0, 80)}
            className={cn("", {
              "rounded-r-none": i === 0,
              "rounded-l-none": i === segments.length - 1,
              "rounded-none": i !== 0 && i !== segments.length - 1,
            })}
          >
            Part {i + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}
