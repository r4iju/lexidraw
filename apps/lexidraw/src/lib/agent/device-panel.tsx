"use client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useSession } from "next-auth/react";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import { api } from "~/trpc/react";
import {
  useBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
  browserByokStorageReady,
} from "../byok/browser-session";
import {
  browserNarrationStore,
  registerNarration,
} from "../narration/device-store";
import { DeviceAgent } from "./device-flow";
import { DeviceAgentView } from "./device-view";
export function DeviceAgentController({
  flow,
  available,
  keyAvailable,
}: {
  flow: DeviceAgent;
  available: boolean;
  keyAvailable: boolean;
}) {
  const checkpoint = useSyncExternalStore(
    flow.subscribe,
    flow.state,
    () => null,
  );
  const admitting = useSyncExternalStore(
    flow.subscribe,
    flow.admitting,
    () => false,
  );
  // Event failures are feedback for the requested action, independent of query state.
  const [notice, setNotice] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    setNotice(null);
    void action().catch(() =>
      setNotice(
        "Local action could not continue safely. Saved edits remain. No automatic provider repeat was made.",
      ),
    );
  };
  // Durable local checkpoints and account lifecycle supply progress outside React.
  useEffect(() => {
    const unregister = registerNarration(flow.account, () => flow.end());
    void flow
      .restore()
      .catch(() =>
        setNotice(
          "Local action could not be restored safely. No provider request was made.",
        ),
      );
    return () => {
      flow.stop();
      unregister();
    };
  }, [flow]);
  return (
    <>
      {notice && <p role="alert">{notice}</p>}
      <DeviceAgentView
        checkpoint={checkpoint}
        admitting={admitting}
        available={available}
        keyAvailable={keyAvailable}
        onStart={({ prompt }) => run(() => flow.start(prompt))}
        onResume={() => run(() => flow.resume())}
        onStop={() => flow.stop()}
        onNewAction={() => run(() => flow.newAction())}
      />
    </>
  );
}
export function DeviceAgentPanel({ documentId }: { documentId: string }) {
  const session = useSession();
  if (session.status !== "authenticated")
    return <p>Sign in to open document actions.</p>;
  return (
    <SignedInDeviceAgent
      key={`${session.data.user.id}:${documentId}`}
      account={session.data.user.id}
      documentId={documentId}
    />
  );
}
function SignedInDeviceAgent({
  account,
  documentId,
}: {
  account: string;
  documentId: string;
}) {
  const byok = useBrowserByok(account);
  if (!byok) return <p>Preparing this account's device session...</p>;
  return (
    <OwnedDeviceAgent
      key={browserByokSessionGeneration()}
      account={account}
      documentId={documentId}
      byok={byok}
    />
  );
}
function OwnedDeviceAgent({
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
  const capability = api.deviceAgent.capability.useQuery();
  const apply = api.deviceAgent.commitEdit.useMutation({
    onSettled: () => utils.entities.load.invalidate(),
  });
  const commitEdit = apply.mutateAsync;
  const access = queryAccess(capability, true, "Device action capability");
  const available = access.kind === "ready" && access.data.available;
  const generation = browserByokSessionGeneration();
  const ports: import("./device-flow").DeviceAgentPorts = {
    account: browserByokAccount,
    session: browserByokSessionGeneration,
    available: () => available,
    byok,
    store: {
      load: async (scope) => {
        await browserByokStorageReady(account);
        return browserNarrationStore.load(scope);
      },
      save: async (scope, data, expected) => {
        await browserByokStorageReady(account);
        if (
          generation !== browserByokSessionGeneration() ||
          browserByokAccount() !== account
        )
          throw new Error("Account session ended");
        return browserNarrationStore.save(
          scope,
          data,
          expected,
          () =>
            browserByokAccount() === account &&
            browserByokSessionGeneration() === generation,
        );
      },
      clear: (scope, expected) =>
        browserNarrationStore.clear(
          scope,
          expected,
          () =>
            browserByokAccount() === account &&
            browserByokSessionGeneration() === generation,
        ),
    },
    read: () => utils.deviceAgent.source.fetch({ documentId }),
    apply: (data) => commitEdit(data),
  };
  // The committed account/document/credential owner controls this controller's lifetime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: committed ports refresh callbacks; query changes do not replace the owner.
  const flow = useMemo(
    () => new DeviceAgent(account, documentId, ports),
    [account, documentId, byok, generation],
  );
  // DeviceAgent receives external query and storage ports after React commits.
  useLayoutEffect(() => {
    flow.configure(ports);
  });
  return (
    <>
      <QueryNotice access={access} retry={() => void capability.refetch()} />
      <DeviceAgentController
        flow={flow}
        available={available}
        keyAvailable={!!reference}
      />
    </>
  );
}
