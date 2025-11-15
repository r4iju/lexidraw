"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { AudioPlayer } from "~/components/ui/audio-player";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Play } from "lucide-react";

type Segment = {
  index: number;
  audioUrl: string;
  text: string;
  durationSec?: number;
  sectionTitle?: string;
  sectionIndex?: number;
};

type Props = {
  segments: Segment[];
  preferredPlaybackRate?: number;
  initialIndex?: number;
};

export default function ArticleAudioPlayer({
  segments,
  preferredPlaybackRate,
  initialIndex,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => {
    if (typeof initialIndex === "number" && initialIndex >= 0) {
      setCurrentIndex(Math.min(initialIndex, Math.max(0, segments.length - 1)));
    }
  }, [initialIndex, segments.length]);
  const current = useMemo(
    () => segments[currentIndex],
    [segments, currentIndex],
  );

  if (!segments.length) return null;

  // Generate segment display names based on headings
  const getSegmentName = (segment: Segment, index: number): string => {
    if (segment.sectionTitle) {
      // Count how many segments up to and including this one share the same sectionTitle
      // This handles multiple chunks per section
      let chunkCount = 0;
      for (let i = 0; i <= index; i++) {
        if (
          segments[i]?.sectionTitle === segment.sectionTitle &&
          (segment.sectionIndex === undefined ||
            segments[i]?.sectionIndex === segment.sectionIndex)
        ) {
          chunkCount++;
        }
      }
      // If this is the first chunk of the section, show just the title
      // Otherwise, append the chunk number
      return chunkCount === 1
        ? segment.sectionTitle
        : `${segment.sectionTitle} (${chunkCount})`;
    }
    // Fallback for segments without headings
    return `Block ${index + 1}`;
  };

  return (
    <div className="space-y-2">
      {current?.sectionTitle && (
        <div className="text-sm text-muted-foreground font-medium">
          {current.sectionTitle}
        </div>
      )}
      <AudioPlayer
        src={current?.audioUrl ?? ""}
        autoPlay
        initialPlaybackRate={preferredPlaybackRate}
        onEnded={() => {
          if (currentIndex < segments.length - 1)
            setCurrentIndex(currentIndex + 1);
        }}
      />
      <Accordion
        type="single"
        collapsible
        className="border border-border rounded-md px-4"
      >
        <AccordionItem value="segments">
          <AccordionTrigger>Segments</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-0 divide-y divide-border">
              {segments.map((s, i) => {
                const segmentName = getSegmentName(s, i);
                const isCurrent = i === currentIndex;
                return (
                  <Button
                    variant={isCurrent ? "default" : "secondary"}
                    key={s.index}
                    onClick={() => setCurrentIndex(i)}
                    className="w-full flex flex-row items-center justify-start gap-2 rounded-none"
                  >
                    <Play
                      className={`size-4 mr-2 ${
                        isCurrent ? "text-primary-foreground" : "text-primary"
                      }`}
                    />
                    <span className="font-mono">{i + 1}.</span>
                    <span>{segmentName}</span>
                  </Button>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
