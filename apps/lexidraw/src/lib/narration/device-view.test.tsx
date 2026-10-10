import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceNarrationView } from "./device-view";
import { audioFromPCM } from "./portable";
test("actual device narration view shows held uncertainty, foreground limits and keyless completed sync/playback", () => {
  const state = {
    version: 1 as const,
    fingerprints: [],
    account: "alice",
    documentId: "doc",
    id: "local",
    created: 1000,
    status: "unknown" as const,
    parts: [{ kind: "unknown" as const, text: "Hello" }],
  };
  const props = {
    available: true,
    keyAvailable: true,
    onStart: () => {},
    onResume: () => {},
    onSync: () => {},
  };
  const unknown = renderToStaticMarkup(
    <DeviceNarrationView {...props} checkpoint={state} />,
  );
  expect(unknown).toContain("may still be billed");
  expect(unknown).toContain("Suspension or shutdown");
  expect(unknown).not.toContain("Resume generation");
  const completed = renderToStaticMarkup(
    <DeviceNarrationView
      {...props}
      keyAvailable={false}
      checkpoint={{
        ...state,
        status: "sync_failed",
        parts: [
          {
            kind: "completed",
            text: "Hello",
            ...audioFromPCM(new Uint8Array(48000), () => {}),
          },
        ],
      }}
    />,
  );
  expect(completed).toContain("Retry sync");
  expect(completed).toContain("controls=");
  expect(completed).not.toContain("Resume generation");
});
