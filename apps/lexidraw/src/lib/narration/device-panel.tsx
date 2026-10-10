"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { browserByok, browserByokAccount } from "../byok/browser-session";
import { Button } from "~/components/ui/button";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import { api } from "~/trpc/react";
import { DeviceNarration } from "./device-flow";
import { browserNarrationStore, registerNarration } from "./device-store";
import { DeviceNarrationView, RecordingControls } from "./device-view";
export function DeviceNarrationController({
  flow,
  available,
  keyAvailable,
  start,
  capabilityKnown = true,
}: {
  flow: DeviceNarration;
  available: boolean;
  keyAvailable: boolean;
  start: () => Promise<void>;
  capabilityKnown?: boolean;
}) {
  const checkpoint = useSyncExternalStore(
    flow.subscribe,
    flow.state,
    () => null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    setNotice(null);
    void action().catch(() =>
      setNotice(
        "Local narration could not continue safely. Retained audio is kept; no automatic provider retry was made.",
      ),
    );
  };
  // The device checkpoint store supplies persisted progress and account lifecycle cleanup.
  useEffect(() => {
    const unregister = registerNarration(flow.account, () => flow.end());
    void flow
      .restore()
      .catch(() =>
        setNotice(
          "Local checkpoint could not be safely restored. No provider request was made.",
        ),
      );
    return unregister;
  }, [flow]);
  return (
    <>
      {notice && <p role="alert">{notice}</p>}
      <DeviceNarrationView
        checkpoint={checkpoint}
        capabilityKnown={capabilityKnown}
        available={available}
        keyAvailable={keyAvailable}
        onStart={() => run(start)}
        onResume={() => run(() => flow.resume())}
        onSync={() => run(() => flow.sync())}
      />
    </>
  );
}
export function DeviceNarrationPanel({ documentId }: { documentId: string }) {
  const { data, status } = useSession();
  if (status !== "authenticated")
    return <p>Sign in to open account recordings.</p>;
  return (
    <SignedInDeviceNarration
      key={`${data.user.id}:${documentId}`}
      account={data.user.id}
      documentId={documentId}
    />
  );
}
function SignedInDeviceNarration({
  account,
  documentId,
}: {
  account: string;
  documentId: string;
}) {
  const utils = api.useUtils(),
    byok = browserByok(account);
  const reference = useSyncExternalStore(
    byok.subscribe,
    byok.reference,
    () => undefined,
  );
  const capability = api.deviceNarration.capability.useQuery(undefined, {
    retry: false,
  });
  const saved = api.deviceNarration.saved.useQuery(
    { documentId },
    { retry: false },
  );
  const save = api.deviceNarration.save.useMutation({
    onSuccess: () => utils.deviceNarration.saved.invalidate({ documentId }),
  });
  const access = queryAccess(capability, true, "Device narration capability");
  const available = access.kind === "ready" && access.data.available;
  const { mutateAsync: saveRecording } = save;
  const ports = {
    account: browserByokAccount,
    available: () => available,
    byok,
    store: browserNarrationStore,
    sync: async (
      id: string,
      recording: import("./device-contracts").RecordingArtifact,
    ) =>
      (await saveRecording({ idempotencyKey: id, documentId, recording })).id,
  };
  // The account/document controller retains checkpoints across capability refreshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: configure supplies current ports each render; only account/document identity owns retained checkpoints.
  const flow = useMemo(
    () => new DeviceNarration(account, documentId, ports),
    [account, documentId],
  );
  flow.configure(ports);
  return (
    <div className="space-y-4">
      <QueryNotice access={access} retry={() => void capability.refetch()} />
      <DeviceNarrationController
        flow={flow}
        capabilityKnown={access.kind === "ready"}
        available={available}
        keyAvailable={!!reference}
        start={async () => {
          const text = await utils.deviceNarration.source.fetch({ documentId });
          await flow.start(text);
        }}
      />
      <section aria-label="Saved account narration">
        <h3>Saved device recording</h3>
        {saved.isLoading ? (
          <p>Loading saved recording…</p>
        ) : saved.error ? (
          <p role="alert">
            Saved recording could not be refreshed.{" "}
            <Button onClick={() => void saved.refetch()}>
              Retry saved recording
            </Button>
          </p>
        ) : null}
        {saved.data ? (
          <>
            <p>
              Replay is free on any signed-in device. No provider key is needed.
            </p>
            <RecordingControls recording={saved.data.recording} />
          </>
        ) : !saved.isPending && !saved.error ? (
          <p>No saved device recording.</p>
        ) : null}
      </section>
    </div>
  );
}
