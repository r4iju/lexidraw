"use client";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useSession } from "next-auth/react";
import {
  useBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
  browserByokStorageReady,
} from "../byok/browser-session";
import { Button } from "~/components/ui/button";
import { queryAccess } from "~/lib/generation/query-access";
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
    let disposed = false;
    let unregister: (() => void) | undefined;
    void flow
      .prepare()
      .then(async () => {
        if (disposed) return;
        unregister = registerNarration(
          flow.account,
          () => flow.end(),
          flow.generation,
        );
        await flow.restore();
      })
      .catch(() => {
        if (!disposed)
          setNotice(
            "Local checkpoint could not be safely restored. No provider request was made.",
          );
      });
    return () => {
      disposed = true;
      flow.stop();
      unregister?.();
    };
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
  if (status !== "authenticated") return null;
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
  const byok = useBrowserByok(account);
  if (!byok) return null;
  return (
    <OwnedDeviceNarration
      key={browserByokSessionGeneration()}
      account={account}
      documentId={documentId}
      byok={byok}
    />
  );
}
function OwnedDeviceNarration({
  account,
  documentId,
  byok,
}: {
  account: string;
  documentId: string;
  byok: ReturnType<typeof import("../byok/browser-session").browserByok>;
}) {
  const utils = api.useUtils();

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
  const generation = browserByokSessionGeneration();
  const checkOwner = () => {
    if (
      browserByokAccount() !== account ||
      browserByokSessionGeneration() !== generation
    )
      throw new Error("Account session ended");
  };
  const ready = async () => {
    checkOwner();
    await browserByokStorageReady(account);
    checkOwner();
  };
  const ports: import("./device-flow").DeviceNarrationPorts = {
    account: browserByokAccount,
    session: browserByokSessionGeneration,
    ready,
    available: () => available,
    byok,
    store: {
      load: async (scope) => {
        await ready();
        const value = await browserNarrationStore.load(scope);
        checkOwner();
        return value;
      },
      save: async (scope, data, expected) => {
        await ready();
        const saved = await browserNarrationStore.save(
          scope,
          data,
          expected,
          () =>
            browserByokAccount() === account &&
            browserByokSessionGeneration() === generation,
        );
        checkOwner();
        return saved;
      },
      clear: async (scope, expected) => {
        await browserNarrationStore.clear(
          scope,
          expected,
          () =>
            browserByokAccount() === account &&
            browserByokSessionGeneration() === generation,
        );
      },
    },
    sync: async (
      id: string,
      recording: import("./device-contracts").RecordingArtifact,
    ) => {
      await ready();
      const receipt = await saveRecording({
        idempotencyKey: id,
        documentId,
        recording,
      });
      checkOwner();
      return receipt.id;
    },
  };
  // The keyed owner retains checkpoints; query changes only refresh committed ports.
  const [flow] = useState(
    () => new DeviceNarration(account, documentId, ports),
  );
  // DeviceNarration receives external query and storage ports after React commits.
  useLayoutEffect(() => {
    flow.configure(ports);
  });
  return (
    <div className="space-y-4">
      <DeviceNarrationController
        flow={flow}
        capabilityKnown={access.kind === "ready"}
        available={available}
        keyAvailable={!!reference}
        start={() =>
          flow.start(() => utils.deviceNarration.source.fetch({ documentId }))
        }
      />
      {saved.error ? (
        <p role="alert" className="text-sm">
          Saved recording could not be refreshed.{" "}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => void saved.refetch()}
          >
            Retry saved recording
          </Button>
        </p>
      ) : saved.data ? (
        <section aria-label="Saved account narration" className="space-y-2">
          <h3 className="text-sm font-medium">
            Saved recording · replay is free
          </h3>
          <RecordingControls
            label="Saved device recording"
            recording={saved.data.recording}
          />
        </section>
      ) : null}
    </div>
  );
}
