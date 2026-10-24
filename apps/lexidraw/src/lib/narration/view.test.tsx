import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AudioPlayerProps } from "~/components/ui/audio-player";
mock.module("~/components/ui/audio-player", () => ({
  AudioPlayer: (props: AudioPlayerProps) => (
    <audio src={props.src} controls>
      <track kind="captions" />
    </audio>
  ),
}));
const { NarrationView } = await import("./view");
const noop = () => {};
test("narration UI discloses maximum, partial failure recovery, reserved uncertainty, and free saved playback controls", () => {
  const view = (screen: Parameters<typeof NarrationView>[0]["screen"]) =>
    renderToStaticMarkup(
      <NarrationView
        screen={screen}
        onQuote={noop}
        onAccept={noop}
        onDismiss={noop}
        onCancel={noop}
        onSaved={noop}
      />,
    );
  expect(
    view({
      kind: "quote",
      quote: {
        periodId: "p",
        maximum: 12_950_000,
        missing: 1,
        cached: 1,
        maxSeconds: 240,
        revision: "r",
        version: "private-narration-2026-10-v1",
        policy: "Technical failures return all credits.",
      },
    }),
  ).toContain("Start · up to 12.95 credits");
  const job = {
    id: "op",
    state: "refunded" as const,
    charged: 0,
    quote: 12_950_000,
    made: 1,
    planned: 2,
    parts: [{ id: "part1", text: "retained", audio: "AA==", seconds: 1 }],
    policy: "Trial cancellation terms",
  };
  expect(view({ kind: "job", job })).toContain("Try again");
  expect(view({ kind: "job", job: { ...job, state: "unknown" } })).toContain(
    "reserved until reconciliation",
  );
  expect(
    view({ kind: "job", job: { ...job, state: "unknown" } }),
  ).not.toContain("Narrate this document");
  expect(view({ kind: "job", job: { ...job, state: "settled" } })).toContain(
    "controls=",
  );
  expect(view({ kind: "job", job: { ...job, state: "saved" } })).toContain(
    "replay is free",
  );
});
