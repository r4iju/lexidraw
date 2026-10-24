import { installDom, render, click } from "~/test/dom";
installDom();
import { afterEach, expect, mock, test } from "bun:test";
import { act, useState, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AudioPlayerProps } from "~/components/ui/audio-player";
import type { SavedRecordingProjection } from "~/lib/narration/saved-recording";
import type { ListenSegment } from "~/lib/narration/listen-contracts";
const saved: SavedRecordingProjection = {
  kind: "saved-recording",
  text: "Original <script>雪 & hello</script>",
  audioUrl: "https://example.invalid/saved.mp3?x=%2F&y=1",
};
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/fixture",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
let serial = 0;
const audioProps: AudioPlayerProps[] = [];
mock.module("~/components/ui/audio-player", () => ({
  AudioPlayer: (props: AudioPlayerProps) => {
    const [identity] = useState(() => ++serial);
    const [playing, setPlaying] = useState(false);
    audioProps.push(props);
    return (
      <div
        data-audio={props.src}
        data-identity={identity}
        data-playing={playing}
      >
        <button type="button" onClick={() => setPlaying(!playing)}>
          User play
        </button>
        <button type="button" onClick={props.onEnded}>
          End fixture
        </button>
      </div>
    );
  },
}));
mock.module("~/lib/narration/device-panel", () => ({
  DeviceNarrationPanel: () => <p>Local narration unavailable in fixture</p>,
}));
mock.module("~/lib/narration/panel", () => ({
  ProNarrationPanel: () => <p>Pro narration unavailable in fixture</p>,
}));
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
let status = "none";
let segments: ListenSegment[] = [];
let recording: unknown = saved;
let pending = false,
  error = false;
let manifestEnabled: boolean | undefined;
const refetch = async () => {};
mock.module("~/trpc/react", () => ({
  api: {
    tts: {
      getDocumentTtsStatus: {
        useQuery: () => {
          useSyncExternalStore(subscribe, () => version);
          return {
            data: { status, segmentCount: segments.length },
            isPending: false,
            error: null,
            refetch,
          };
        },
      },
      getDocumentTtsManifest: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => {
          useSyncExternalStore(subscribe, () => version);
          manifestEnabled = options.enabled;
          return {
            data:
              options.enabled && !pending
                ? { segments, savedRecording: recording }
                : undefined,
            isPending: pending,
            error: error ? new Error("Synthetic content error") : null,
            refetch,
          };
        },
      },
    },
  },
}));
const { LexicalComposer } = await import("@lexical/react/LexicalComposer");
const { ListenPlayer } = await import("./ListenPlayer");
const { SavedRecordingPlayback } = await import("./SavedRecordingPlayback");
let mounted: Awaited<ReturnType<typeof render>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  audioProps.length = 0;
  status = "none";
  segments = [];
  recording = saved;
  pending = false;
  error = false;
});
function Page({
  documentId = "doc-1",
  open = true,
}: {
  documentId?: string;
  open?: boolean;
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "saved-fixture",
        onError: (e) => {
          throw e;
        },
      }}
    >
      <ListenPlayer
        documentId={documentId}
        open={open}
        onOpenChange={() => {}}
        anchor={null}
      />
    </LexicalComposer>
  );
}
async function update(fn: () => void) {
  await act(async () => {
    fn();
    version++;
    for (const listener of listeners) listener();
  });
}
const savedPlayer = () =>
  document.querySelector(
    '[data-audio="https://example.invalid/saved.mp3?x=%2F&y=1"]',
  );
function requireSaved() {
  const player = savedPlayer();
  expect(player).not.toBeNull();
  return player;
}

test("static saved lane uses exact user-start audio and escapes original transcript", () => {
  const markup = renderToStaticMarkup(
    <SavedRecordingPlayback documentId="doc-1" screen={saved} />,
  );
  expect(markup).toContain("Saved recording");
  expect(markup).toContain(
    "Original &lt;script&gt;雪 &amp; hello&lt;/script&gt;",
  );
  expect(markup).not.toContain("<script>");
  expect(audioProps.at(-1)).toEqual({
    src: "https://example.invalid/saved.mp3?x=%2F&y=1",
    autoPlay: false,
    className: "w-full",
  });
  expect(markup).not.toContain("Segments");
  expect(markup).not.toContain("Making the next part");
});
for (const [kind, label] of [
  ["loading", "Loading saved recording"],
  ["read-error", "Saved recording could not be refreshed"],
  ["stop", "Saved recording could not be read safely"],
] as const) {
  test(`static ${kind} is truthful and mounts no saved media or transcript`, () => {
    const screen =
      kind === "stop" ? { kind, reason: "unsupported-tts" as const } : { kind };
    const markup = renderToStaticMarkup(
      <SavedRecordingPlayback documentId="doc-1" screen={screen} />,
    );
    expect(markup).toContain(label);
    expect(markup).not.toContain("data-audio");
    expect(markup).not.toContain("Original");
    expect(audioProps).toHaveLength(0);
  });
}
test("no-job Listen reads saved content while local and Pro fixture panels are unavailable", async () => {
  mounted = await render(<Page />);
  expect(manifestEnabled).toBe(true);
  expect(requireSaved()?.getAttribute("data-playing")).toBe("false");
  expect(document.body.textContent).toContain("Saved recording");
  expect(document.body.textContent).toContain(
    "Original <script>雪 & hello</script>",
  );
  expect(document.body.textContent).not.toContain(
    "No saved audio is available",
  );
  expect(document.body.textContent).toContain(
    "Local narration unavailable in fixture",
  );
  expect(document.body.textContent).toContain(
    "Pro narration unavailable in fixture",
  );
});
test("saved identity survives generated append, replacement and transcript changes, then resets for URL/document/session", async () => {
  mounted = await render(<Page />);
  const initial = requireSaved();
  const identity = initial?.getAttribute("data-identity");
  await click(initial?.querySelector("button"));
  await update(() => {
    status = "processing";
    segments = [
      {
        index: 0,
        text: "Generated",
        audioUrl: "https://example.invalid/generated-1",
      },
    ];
  });
  expect(requireSaved()).toBe(initial);
  expect(initial?.getAttribute("data-playing")).toBe("true");
  await update(() => {
    segments = [
      ...segments,
      {
        index: 1,
        text: "Next",
        audioUrl: "https://example.invalid/generated-2",
      },
    ];
  });
  expect(requireSaved()?.getAttribute("data-identity")).toBe(identity);
  await update(() => {
    segments = [
      {
        index: 0,
        text: "Replacement",
        audioUrl: "https://example.invalid/replacement",
      },
    ];
    recording = { ...saved, text: "Another original transcript" };
  });
  expect(requireSaved()).toBe(initial);
  expect(document.body.textContent).toContain("Another original transcript");
  await update(() => {
    recording = {
      ...saved,
      audioUrl: "https://example.invalid/replaced-saved",
    };
  });
  const replaced = document.querySelector(
    '[data-audio="https://example.invalid/replaced-saved"]',
  );
  expect(replaced?.getAttribute("data-identity")).not.toBe(identity);
  expect(replaced?.getAttribute("data-playing")).toBe("false");
  await mounted.rerender(<Page documentId="doc-2" />);
  const next = document.querySelector(
    '[data-audio="https://example.invalid/replaced-saved"]',
  );
  expect(next).not.toBe(replaced);
  await mounted.rerender(<Page documentId="doc-2" open={false} />);
  expect(document.querySelector("[data-audio]")).toBeNull();
  await mounted.rerender(<Page documentId="doc-2" />);
  expect(
    document.querySelector(
      '[data-audio="https://example.invalid/replaced-saved"]',
    ),
  ).not.toBe(next);
});
test("saved end is independent while generated end follows appended parts", async () => {
  status = "processing";
  segments = [
    {
      index: 0,
      text: "First",
      audioUrl: "https://example.invalid/generated-1",
    },
  ];
  mounted = await render(<Page />);
  const initial = requireSaved();
  await click(initial?.querySelectorAll("button")[1]);
  expect(requireSaved()).toBe(initial);
  expect(document.body.textContent).not.toContain("Making the next part");
  const generated = document.querySelector(
    '[data-audio="https://example.invalid/generated-1"]',
  );
  await click(generated?.querySelectorAll("button")[1]);
  expect(document.body.textContent).toContain("Making the next part");
  await update(() => {
    segments = [
      ...segments,
      {
        index: 1,
        text: "Next",
        audioUrl: "https://example.invalid/generated-2",
      },
    ];
  });
  expect(
    document.querySelector(
      '[data-audio="https://example.invalid/generated-2"]',
    ),
  ).not.toBeNull();
  expect(requireSaved()).toBe(initial);
});
test("STOP and malformed saved response hide only saved lane, none preserves generated playback", async () => {
  status = "ready";
  segments = [
    {
      index: 0,
      text: "Generated",
      audioUrl: "https://example.invalid/generated-1",
    },
  ];
  recording = { kind: "stop", reason: "unsupported-tts" };
  mounted = await render(<Page />);
  expect(document.body.textContent).toContain(
    "Saved recording could not be read safely",
  );
  expect(savedPlayer()).toBeNull();
  expect(document.body.textContent).not.toContain("Original");
  const generated = document.querySelector(
    '[data-audio="https://example.invalid/generated-1"]',
  );
  expect(generated).not.toBeNull();
  await update(() => {
    recording = { kind: "saved-recording", text: "Secret", audioUrl: 7 };
  });
  expect(document.body.textContent).toContain(
    "Saved recording could not be read safely",
  );
  expect(document.body.textContent).not.toContain("Secret");
  expect(
    document.querySelector(
      '[data-audio="https://example.invalid/generated-1"]',
    ),
  ).toBe(generated);
  await update(() => {
    recording = { kind: "none" };
  });
  expect(document.body.textContent).not.toContain("Saved recording");
  expect(document.body.textContent).not.toContain(
    "Saved recording could not be read safely",
  );
  expect(
    document.querySelector(
      '[data-audio="https://example.invalid/generated-1"]',
    ),
  ).toBe(generated);
});
test("pending and failed saved reads stay distinct and do not play stale saved audio", async () => {
  pending = true;
  mounted = await render(<Page />);
  expect(document.body.textContent).toContain("Loading saved recording");
  expect(savedPlayer()).toBeNull();
  await update(() => {
    pending = false;
    error = true;
  });
  expect(document.body.textContent).toContain(
    "Saved recording could not be refreshed",
  );
  expect(savedPlayer()).toBeNull();
  expect(document.body.textContent).not.toContain("Original");
});
