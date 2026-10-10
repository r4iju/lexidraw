"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { browserByok, browserByokAccount } from "../byok/browser-session";
import { api } from "~/trpc/react";
import { DeviceNarration } from "./device-flow";
import { browserNarrationStore, registerNarration } from "./device-store";
import { DeviceNarrationView, RecordingControls } from "./device-view";
export function DeviceNarrationController({
  flow,
  available,
  keyAvailable,
  start,
}: {
  flow: DeviceNarration;
  available: boolean;
  keyAvailable: boolean;
  start: () => Promise<void>;
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
  const available = capability.data?.available === true;
  const { mutateAsync: saveRecording } = save;
  const flow = useMemo(
    () =>
      new DeviceNarration(account, documentId, {
        account: browserByokAccount,
        available: () => available,
        byok,
        store: browserNarrationStore,
        sync: async (id, recording) =>
          (
            await saveRecording({
              idempotencyKey: id,
              documentId,
              recording,
            })
          ).id,
      }),
    [account, documentId, available, byok, saveRecording],
  );
  return (
    <div className="space-y-4">
      <DeviceNarrationController
        flow={flow}
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
          <p>Saved recording could not be loaded.</p>
        ) : saved.data ? (
          <>
            <p>
              Replay is free on any signed-in device. No provider key is needed.
            </p>
            <RecordingControls recording={saved.data.recording} />
          </>
        ) : (
          <p>No saved device recording.</p>
        )}
      </section>
    </div>
  );
}
