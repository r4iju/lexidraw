"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useMemo,
  useId,
} from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const lastPathRef = useRef(pathname);
  const prevSrcRef = useRef<string | undefined>(undefined);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [displayTime, setDisplayTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(initialVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(initialPlaybackRate);
  const hasUserAdjustedRateRef = useRef(false);
  // Track latest rate for effects that should not re-run on rate changes
  // Initialize with initialPlaybackRate, but update immediately to current rate state
  const latestRateRef = useRef(initialPlaybackRate);
  useEffect(() => {
    latestRateRef.current = rate;
  }, [rate]);

  // Fetch preferred playback rate (authenticated users only)
  const audioCfg = api.config.getAudioConfig.useQuery(undefined, {
    enabled: persistPreferredRate,
    staleTime: 5 * 60 * 1000,
  });
  const utils = api.useUtils();
  const updateAudioCfg = api.config.updateAudioConfig.useMutation({
    onSuccess: (data) => {
      console.log("[AudioPlayer] saved playback rate to server", data);
      // Update query cache so subsequent reads reflect the saved value
      utils.config.getAudioConfig.setData(undefined, data);
    },
    onError: (error) => {
      console.error("[AudioPlayer] failed to save playback rate", error);
    },
  });

  // Apply preferred playback rate once (on data resolve) unless user already adjusted
  useEffect(() => {
    if (!persistPreferredRate) return;
    const preferred = audioCfg.data?.preferredPlaybackRate;
    if (hasUserAdjustedRateRef.current) return;
    if (typeof preferred === "number" && preferred > 0) {
      setRate(preferred);
      if (audioRef.current) audioRef.current.playbackRate = preferred;
    }
  }, [audioCfg.data?.preferredPlaybackRate, persistPreferredRate]);

  // Wire up audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const minSpeed: number = 0.75;
    const maxSpeed: number = 2;

    const handleLoaded = () => {
      setDuration(audio.duration || 0);
      // Keep currentTime if set from previous src; reset if different source
      setCurrentTime(audio.currentTime || 0);
      // Reapply playback rate to ensure it persists across src changes
      const clampedRate = Math.min(
        maxSpeed,
        Math.max(minSpeed, latestRateRef.current),
      );
      audio.playbackRate = clampedRate;
      console.log("[AudioPlayer] reapplied playback rate on loadedmetadata", {
        rate: clampedRate,
        latestRateRef: latestRateRef.current,
      });
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

  // Apply rate to audio element
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
  }, [rate]);

  // Unmount cleanup: pause and clear audio element (layout effect for reliability)
  useLayoutEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        console.log("pausing audio on unmount");
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);

  // Pause on route changes (component may be preserved across layouts in Next.js 16)
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        console.log("pausing audio on route change");
        audio.pause();
      }
    }
  }, [pathname]);

  // Pause when page is hidden or being put into bfcache
  useEffect(() => {
    const pause = () => {
      audioRef.current?.pause();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        pause();
      }
    };
    window.addEventListener("pagehide", pause);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      console.log("removing pagehide and visibilitychange listeners");
      window.removeEventListener("pagehide", pause);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Pause on SPA navigations (Navigation API with history/popstate fallback)
  useEffect(() => {
    const pause = () => {
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
    };

    const nav = (
      window as Window & {
        navigation?: {
          addEventListener?: (type: "navigate", listener: () => void) => void;
          removeEventListener?: (
            type: "navigate",
            listener: () => void,
          ) => void;
        };
      }
    ).navigation;

    if (nav && typeof nav.addEventListener === "function") {
      const onNavigate = () => pause();
      nav.addEventListener("navigate", onNavigate);
      return () => {
        nav.removeEventListener?.("navigate", onNavigate);
      };
    }

    const onPop = () => pause();
    window.addEventListener("popstate", onPop);

    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    type PushArgs = Parameters<typeof history.pushState>;
    type ReplaceArgs = Parameters<typeof history.replaceState>;
    const onHistoryChange = () => pause();

    history.pushState = (...args: PushArgs) => {
      originalPush(...args);
      onHistoryChange();
    };

    history.replaceState = (...args: ReplaceArgs) => {
      originalReplace(...args);
      onHistoryChange();
    };

    return () => {
      window.removeEventListener("popstate", onPop);
      history.pushState = originalPush;
      history.replaceState = originalReplace;
    };
  }, []);

  // Reset audio state when src changes (do not depend on rate to avoid restart)
  useEffect(() => {
    console.log("[AudioPlayer] src effect triggered", {
      src,
      prevSrc: prevSrcRef.current,
    });
    // Only process if src actually changed
    if (prevSrcRef.current === src) {
      console.log("[AudioPlayer] src unchanged, skipping");
      return;
    }
    prevSrcRef.current = src;

    setCurrentTime(0);
    setDisplayTime(null);
    setIsPlaying(false);

    const audio = audioRef.current;
    if (!audio) {
      console.log("[AudioPlayer] no audio element found");
      return;
    }

    console.log("[AudioPlayer] audio element state", {
      src: audio.src,
      expectedSrc: src,
      readyState: audio.readyState,
      paused: audio.paused,
      currentTime: audio.currentTime,
    });

    // Pause and reset before loading new source
    audio.pause();
    audio.currentTime = 0;
    // Preserve playback rate across src changes
    console.log("[AudioPlayer] preserving playback rate", {
      latestRateRef: latestRateRef.current,
    });
    audio.playbackRate = latestRateRef.current;

    // Explicitly set src attribute (React may not have updated DOM yet)
    audio.src = src;
    console.log(
      "[AudioPlayer] set audio.src to",
      src,
      "actual src:",
      audio.src,
    );

    // Call load() to trigger browser to fetch new source
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      const a = audioRef.current;
      console.log("[AudioPlayer] requestAnimationFrame callback", {
        hasAudio: !!a,
        audioSrc: a?.src,
        expectedSrc: src,
        readyState: a?.readyState,
      });
      if (a) {
        // Verify src is still set (might have been cleared by React)
        if (!a.src || a.src !== src) {
          console.log("[AudioPlayer] src was cleared, re-setting to", src);
          a.src = src;
        }
        console.log("[AudioPlayer] calling load()");
        a.load();
        console.log("[AudioPlayer] load() called, readyState:", a.readyState);
      } else {
        console.log("[AudioPlayer] no audio element in requestAnimationFrame");
      }
    });

    if (!autoPlay) {
      console.log("[AudioPlayer] autoplay disabled");
      return;
    }

    const tryPlay = () => {
      const a = audioRef.current;
      console.log("[AudioPlayer] tryPlay()", {
        hasAudio: !!a,
        audioSrc: a?.src,
        expectedSrc: src,
        readyState: a?.readyState,
        paused: a?.paused,
      });
      if (a && a.src === src) {
        console.log("[AudioPlayer] attempting play()");
        void a.play().catch((err) => {
          console.error("[AudioPlayer] play() failed", err);
        });
      } else {
        console.log("[AudioPlayer] skipping play() - src mismatch");
      }
    };

    // Wait for loadeddata event after load()
    const onLoaded = () => {
      console.log("[AudioPlayer] loadeddata event fired", {
        src: audio.src,
        duration: audio.duration,
        readyState: audio.readyState,
      });
      tryPlay();
      audio.removeEventListener("loadeddata", onLoaded);
    };
    console.log("[AudioPlayer] adding loadeddata listener");
    audio.addEventListener("loadeddata", onLoaded);

    // Also log other loading events for debugging
    const onLoadStart = () => console.log("[AudioPlayer] loadstart event");
    const onCanPlay = () =>
      console.log("[AudioPlayer] canplay event", {
        readyState: audio.readyState,
      });
    const onError = (e: Event) => console.error("[AudioPlayer] error event", e);

    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("error", onError);

    return () => {
      console.log("[AudioPlayer] cleaning up src effect listeners");
      audio.removeEventListener("loadeddata", onLoaded);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
    };
  }, [autoPlay, src]);

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

  const speedSliderId = useId();
  const volumeSliderId = useId();
  const seekSliderId = useId();

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
              type="button"
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
              id={seekSliderId}
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
            <Button
              aria-label="Volume"
              variant="secondary"
              size="icon"
              type="button"
            >
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
                type="button"
              >
                {muted ? (
                  <VolumeX className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </Button>
              <Slider
                id={volumeSliderId}
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
              type="button"
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
                  id={speedSliderId}
                  aria-label="Playback speed"
                  className="relative z-10"
                  min={minSpeed}
                  max={maxSpeed}
                  step={0.25}
                  value={[rate]}
                  onValueChange={(v) => {
                    hasUserAdjustedRateRef.current = true;
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
                      console.log(
                        "[AudioPlayer] saving playback rate",
                        snapped,
                      );
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
