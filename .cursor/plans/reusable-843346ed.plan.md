<!-- 843346ed-8c8d-4952-81db-46627ecb418c 8cb7e9cf-1211-4177-a880-055080ac6874 -->
# Implement a reusable AudioPlayer with markers and integrate it

### What we'll build

- A generic `AudioPlayer` in `apps/lexidraw/src/components/ui/audio-player.tsx` styled with our tokens (`bg-secondary`, `bg-primary`, `text-muted-foreground`, radii). It includes:
  - Play/Pause, seek slider with time (current/duration)
  - Volume control in a popover using the existing `Slider`
  - Playback speed selector in a popover
  - Optional `markers` prop to render chapter ticks on the seek track with tooltips and click-to-seek

### Key props (concise API)

```ts
export type AudioMarker = { time: number; label?: string };

export type AudioPlayerProps = {
  src: string;
  title?: string;
  markers?: AudioMarker[];
  initialVolume?: number; // 0..1
  initialPlaybackRate?: number; // e.g., 1, 1.25, 1.5, 2
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
};
```

### Implementation notes

- Use `~/components/ui/slider` for seek and volume; overlay marker ticks inside the Track (absolute positioned, tooltipped, clickable)
- Use `Tooltip`, `Popover`, and `Button` primitives; icons from `lucide-react` (Play, Pause, Volume, VolumeX)
- Format time as mm:ss or hh:mm:ss; sync state via `audio` events (`loadedmetadata`, `timeupdate`, `play`, `pause`, `ended`)
- No `globals.css` changes; rely on semantic tokens

### Integration

- Replace the inline `<audio>` element in `ArticleAudioPlayer` with the new `AudioPlayer`, keeping the segments button strip as-is

Code area to swap:

```30:45:apps/lexidraw/src/components/audio/ArticleAudioPlayer.tsx
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
```

Replace with a usage like:

```tsx
<AudioPlayer
  src={current?.audioUrl}
  title={title}
  onEnded={() => {
    if (currentIndex < segments.length - 1) setCurrentIndex(currentIndex + 1);
  }}
/>
```

### Visual/UX

- Compact horizontal layout; seek bar full width; controls grouped left (play/pause), right (volume popover, speed popover)
- Markers: subtle 1px-2px bars using `bg-muted-foreground/40`; active range is `bg-primary`
- Tooltips on interactive controls and marker labels (if provided)

### Non-goals (now)

- Skip ±15s, download, playlist UI — can add later

### To-dos

- [ ] Create `components/ui/audio-player.tsx` with core controls
- [ ] Add markers overlay with tooltips and click-to-seek
- [ ] Add volume popover using `Slider`
- [ ] Add playback speed popover and state wiring
- [ ] Replace `<audio>` in `ArticleAudioPlayer` with `AudioPlayer`
- [ ] Polish a11y (aria, focus), tokens, hover/active states