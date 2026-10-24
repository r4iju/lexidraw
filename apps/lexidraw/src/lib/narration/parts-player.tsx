"use client";
import { SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { AudioPlayer } from "~/components/ui/audio-player";
import { Button } from "~/components/ui/button";

export type PlayerPart = { id: string; text: string; src: string };

/**
 * One player for a recording made of parts: it plays them in order, follows
 * parts still arriving while `more` is set, and shows the line being read.
 */
export function PartsPlayer({
  parts,
  label,
  more = false,
}: {
  parts: PlayerPart[];
  label: string;
  /** Whether further parts are still being made after the last listed. */
  more?: boolean;
}) {
  const [index, setIndex] = useState(0);
  // Only a part reached by playing on starts by itself.
  const [playing, setPlaying] = useState(false);
  const current = parts[index];
  // Past the last part, it keeps that part until the next one arrives.
  const shown = current ?? parts.at(-1);
  if (!shown) return null;
  const position = Math.min(index, parts.length - 1);
  const go = (next: number) => {
    setPlaying(true);
    setIndex(next);
  };
  return (
    <section aria-label={label} className="space-y-1.5">
      <AudioPlayer
        key={shown.src}
        src={shown.src}
        autoPlay={playing && !!current}
        onEnded={() => {
          if (index < parts.length - 1 || more) go(index + 1);
        }}
        className="w-full"
      />
      {(parts.length > 1 || more) && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous part"
            disabled={position === 0}
            onClick={() => go(position - 1)}
          >
            <SkipBack className="size-4" />
          </Button>
          <span aria-live="polite">
            {current
              ? `Part ${index + 1} of ${parts.length}${more ? "+" : ""}`
              : "Waiting for the next part…"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next part"
            disabled={position >= parts.length - 1}
            onClick={() => go(position + 1)}
          >
            <SkipForward className="size-4" />
          </Button>
        </div>
      )}
      <p className="line-clamp-2 text-sm text-muted-foreground">{shown.text}</p>
    </section>
  );
}
