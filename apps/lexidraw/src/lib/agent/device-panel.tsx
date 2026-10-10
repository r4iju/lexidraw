"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import {
  browserByok,
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
        available={available}
        keyAvailable={keyAvailable}
        onStart={(prompt) => run(() => flow.start(prompt))}
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
  const utils = api.useUtils(),
    byok = browserByok(account);
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
  const available = capability.data?.available === true;
  const flow = useMemo(
    () =>
      new DeviceAgent(account, documentId, {
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
            const generation = browserByokSessionGeneration();
            await browserByokStorageReady(account);
            if (
              generation !== browserByokSessionGeneration() ||
              browserByokAccount() !== account
            )
              throw new Error("Account session ended");
            return browserNarrationStore.save(scope, data, expected);
          },
          clear: browserNarrationStore.clear,
        },
        read: () => utils.deviceAgent.source.fetch({ documentId }),
        apply: (data) => commitEdit(data),
      }),
    [account, documentId, available, byok, utils, commitEdit],
  );
  if (capability.isPending) return <p>Checking device actions...</p>;
  if (capability.isError) return <p>Could not check device actions.</p>;
  return (
    <DeviceAgentController
      flow={flow}
      available={available}
      keyAvailable={!!reference}
    />
  );
}
