"use client";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
export function OwnedChatRecovery({ documentId }: { documentId: string }) {
  const session = useSession();
  if (session.status !== "authenticated") return null;
  return (
    <AccountChatRecovery
      key={JSON.stringify([session.data.user.id, documentId])}
      accountId={session.data.user.id}
      documentId={documentId}
    />
  );
}
function AccountChatRecovery({
  accountId,
  documentId,
}: {
  accountId: string;
  documentId: string;
}) {
  const utils = api.useUtils();
  const current = api.pro.chatCurrent.useQuery(
    { documentId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((operation) =>
          ["reserved", "running"].includes(operation.state),
        )
          ? 1000
          : false,
    },
  );
  const unscoped = api.pro.chatUnscoped.useQuery();
  const cancelUnscoped = api.pro.cancel.useMutation({
    onSuccess: (operation) =>
      utils.pro.chatUnscoped.setData(undefined, (values) =>
        values?.map((value) => (value.id === operation.id ? operation : value)),
      ),
    onSettled: () =>
      Promise.all([
        utils.pro.chatUnscoped.invalidate(),
        utils.pro.status.invalidate(),
      ]),
  });
  const cancel = api.pro.chatCancel.useMutation({
    onSuccess: (operation) =>
      utils.pro.chatCurrent.setData({ documentId }, (values) =>
        values?.map((value) => (value.id === operation.id ? operation : value)),
      ),
    onSettled: () =>
      Promise.all([
        utils.pro.chatCurrent.invalidate(),
        utils.pro.status.invalidate(),
      ]),
  });
  const owned =
    current.data?.filter((operation) => operation.account_id === accountId) ??
    [];
  const earlier =
    unscoped.data?.filter((operation) => operation.account_id === accountId) ??
    [];
  if (
    owned.length === 0 &&
    earlier.length === 0 &&
    !current.isError &&
    !unscoped.isError &&
    !cancel.isError &&
    !cancelUnscoped.isError
  )
    return null;
  return (
    <details className="mx-3 shrink-0 rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Recent Pro chats</summary>
      <section aria-label="Owned Pro chats" className="max-h-48 space-y-2 overflow-y-auto break-words pt-3">
        {current.isPending ? (
          <p role="status">Checking recent chats…</p>
        ) : current.isError ? (
          <p role="alert">
            Could not refresh recent chats. Try refreshing before sending again.
          </p>
        ) : null}
        {cancel.isError && (
          <p role="alert">
            Cancellation could not be confirmed. Refresh to check whether the
            chat is still running.
          </p>
        )}
        {owned.map((operation) => (
          <div key={operation.id}>
            <p>
              Status: {operation.state}. Used {operation.charged / 1_000_000}{" "}
              credits.
            </p>
            {operation.result && <p>{operation.result}</p>}
            {["reserved", "running", "unknown"].includes(operation.state) && (
              <Button
                disabled={cancel.isPending}
                onClick={() =>
                  void cancel
                    .mutateAsync({ documentId, id: operation.id })
                    .catch(() => {})
                }
              >
                Stop chat
              </Button>
            )}
          </div>
        ))}
        <Button onClick={() => void current.refetch()}>Refresh chats</Button>
        {(earlier.length > 0 || unscoped.isError || cancelUnscoped.isError) && (
          <section
            aria-label="Earlier account Pro chats"
            className="space-y-2 border-t border-border pt-3"
          >
            <p>Older chats</p>
            <p className="text-muted-foreground">
              These chats were started before document history was available.
            </p>
            {unscoped.isPending ? (
              <p>Checking earlier account chats...</p>
            ) : unscoped.isError ? (
              <p role="alert">
                Earlier account chats could not be read. Retry without starting
                new work.
              </p>
            ) : null}
            {cancelUnscoped.isError && (
              <p role="alert">
                Account chat cancellation is not confirmed. Refresh status.
              </p>
            )}
            {earlier.map((operation) => (
              <div key={operation.id}>
                <p>
                  Status: {operation.state}. Used{" "}
                  {operation.charged / 1_000_000} credits.
                </p>
                {operation.result && <p>{operation.result}</p>}
                {["reserved", "running", "unknown"].includes(
                  operation.state,
                ) && (
                  <Button
                    disabled={cancelUnscoped.isPending}
                    onClick={() =>
                      void cancelUnscoped
                        .mutateAsync({ id: operation.id })
                        .catch(() => {})
                    }
                  >
                    Stop older chat
                  </Button>
                )}
              </div>
            ))}
            <Button onClick={() => void unscoped.refetch()}>
              Refresh older chats
            </Button>
          </section>
        )}
      </section>
    </details>
  );
}
