"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Button } from "~/components/ui/button";
import { Slider } from "~/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { Pause, Play, Volume2, Volume1, VolumeX, Gauge } from "lucide-react";
import { api } from "~/trpc/react";

export type AudioMarker = { time: number; label?: string };

export type AudioPlayerProps = {
  src: string;
  markers?: AudioMarker[];
  initialVolume?: number; // 0..1
  initialPlaybackRate?: number; // e.g., 1, 1.25, 1.5, 2
  autoPlay?: boolean;
  className?: string;
  /** If true, read + persist preferred rate for authenticated users */
  persistPreferredRate?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
};

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function AudioPlayer({
  src,
  markers,
  initialVolume = 1,
  initialPlaybackRate = 1,
  autoPlay = false,
  persistPreferredRate = true,
  className,
  onPlay,
  onPause,
  onEnded,
}: Readonly<AudioPlayerProps>): React.ReactNode {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [displayTime, setDisplayTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(initialVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(initialPlaybackRate);

  // Fetch preferred playback rate (authenticated users only)
  const audioCfg = api.config.getAudioConfig.useQuery(undefined, {
    enabled: persistPreferredRate,
    staleTime: 5 * 60 * 1000,
  });
  const updateAudioCfg = api.config.updateAudioConfig.useMutation();

  useEffect(() => {
    if (!persistPreferredRate) return;
    const preferred = audioCfg.data?.preferredPlaybackRate;
    if (typeof preferred === "number" && preferred > 0 && preferred !== rate) {
      setRate(preferred);
      if (audioRef.current) audioRef.current.playbackRate = preferred;
    }
  }, [audioCfg.data?.preferredPlaybackRate, persistPreferredRate, rate]);

  // Wire up audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoaded = () => {
      setDuration(audio.duration || 0);
      // Keep currentTime if set from previous src; reset if different source
      setCurrentTime(audio.currentTime || 0);
      // Autoplay behavior: if previously playing or first load, do not auto; user gesture preferred
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };
    const handlePlay = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const handlePause = () => {
      setIsPlaying(false);
      onPause?.();
    };
    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };

    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [onEnded, onPause, onPlay]);

  // Apply volume & mute & rate to element
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : Math.min(Math.max(volume, 0), 1);
  }, [volume, muted]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    // reference src so dependency matches usage and linter doesn't flag it
    void src;
    setCurrentTime(0);
    setDisplayTime(null);
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.load();
      // ensure playback rate persists across source changes
      audio.playbackRate = rate;
      if (autoPlay) {
        void audio.play().catch(() => undefined);
      }
    }
  }, [autoPlay, rate, src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else void audio.play();
  };

  const toggleMute = () => {
    setMuted((m) => !m);
  };

  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon =
    effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;

  const speeds = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
  const minSpeed: number = 0.75;
  const maxSpeed: number = 2;

  const safeMarkers = useMemo(() => {
    if (!markers || duration <= 0) return [] as AudioMarker[];
    return markers
      .filter((m) => m.time >= 0 && m.time <= duration)
      .sort((a, b) => a.time - b.time);
  }, [markers, duration]);

  return (
    <div
      className={cn(
        "w-full rounded-md border border-border bg-card p-3",
        className,
      )}
    >
      {/** biome-ignore lint/a11y/useMediaCaption: todo: add caption */}
      <audio ref={audioRef} src={src} preload="metadata" playsInline />

      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={togglePlay}
              size="icon"
              variant="secondary"
            >
              {isPlaying ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPlaying ? "Pause" : "Play"}</TooltipContent>
        </Tooltip>

        {/* Seekbar + time */}
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="relative">
            {/* Marker overlay */}
            {duration > 0 && safeMarkers.length > 0 ? (
              <div className="pointer-events-none absolute inset-0">
                {safeMarkers.map((m, idx) => {
                  const left = `${(m.time / duration) * 100}%`;
                  const label = m.label ?? formatTime(m.time);
                  return (
                    <Tooltip key={`${m.time}-${idx}`}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="pointer-events-auto absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-muted-foreground/50 hover:bg-muted-foreground"
                          style={{ left }}
                          aria-label={`Jump to ${label}`}
                          onClick={() => {
                            if (!audioRef.current) return;
                            audioRef.current.currentTime = m.time;
                            setCurrentTime(m.time);
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ) : null}

            <Slider
              aria-label="Seek"
              value={[displayTime ?? currentTime]}
              min={0}
              max={Math.max(duration, 0.000001)}
              step={0.1}
              onValueChange={(v) => setDisplayTime(v[0] ?? null)}
              onValueCommit={(v) => {
                const t = v[0] ?? 0;
                setDisplayTime(null);
                setCurrentTime(t);
                if (audioRef.current) audioRef.current.currentTime = t;
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatTime(displayTime ?? currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume */}
        <Popover>
          <PopoverTrigger asChild>
            <Button aria-label="Volume" variant="secondary" size="icon">
              <VolumeIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" sideOffset={8}>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="icon"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={toggleMute}
              >
                {muted ? (
                  <VolumeX className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </Button>
              <Slider
                aria-label="Volume"
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(v) => {
                  const next = v[0] ?? 0;
                  setVolume(next);
                  if (next === 0) setMuted(true);
                  else if (muted) setMuted(false);
                }}
              />
            </div>
          </PopoverContent>
        </Popover>

        {/* Speed */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              aria-label="Playback speed"
              variant="secondary"
              className="px-2 min-w-18"
            >
              <Gauge className="mr-1 size-4" /> {rate}x
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" sideOffset={8}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Speed</span>
                <span className="font-medium">{rate}x</span>
              </div>
              <div className="relative px-1 py-2">
                {/* tick marks overlay (raised to avoid label overlap) */}
                <div className="pointer-events-none absolute inset-x-2 top-[calc(50%-10px)]">
                  {speeds.map((s) => {
                    const left = `${((s - minSpeed) / (maxSpeed - minSpeed)) * 100}%`;
                    return (
                      <div
                        key={`tick-${s}`}
                        className="absolute h-3 w-1 rounded-b-full bg-muted"
                        style={{ left }}
                      />
                    );
                  })}
                </div>
                <Slider
                  aria-label="Playback speed"
                  min={minSpeed}
                  max={maxSpeed}
                  step={0.25}
                  value={[rate]}
                  onValueChange={(v) => {
                    const next = v[0] ?? rate;
                    // snap to two decimals to avoid float noise
                    const snapped = Math.min(
                      maxSpeed,
                      Math.max(minSpeed, Math.round(next * 100) / 100),
                    );
                    setRate(snapped);
                  }}
                  onValueCommit={(v) => {
                    const next = v[0] ?? rate;
                    const snapped = Math.min(
                      maxSpeed,
                      Math.max(minSpeed, Math.round(next * 100) / 100),
                    );
                    setRate(snapped);
                    if (persistPreferredRate) {
                      updateAudioCfg.mutate({ preferredPlaybackRate: snapped });
                    }
                  }}
                />
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>{minSpeed}x</span>
                  <span>{maxSpeed}x</span>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
