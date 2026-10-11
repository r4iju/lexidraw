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
  return (
    <section aria-label="Owned Pro chats" className="space-y-2 p-2">
      {current.isPending ? (
        <p role="status">Checking owned chat status...</p>
      ) : current.isError ? (
        <p role="alert">
          Owned chat status could not be loaded. Retained status may be out of
          date. Retry the read without starting another turn.
        </p>
      ) : owned.length === 0 ? (
        <p>No owned Pro chat operation.</p>
      ) : null}
      {cancel.isError && (
        <p role="alert">
          Cancellation is not confirmed. Further work may still be running.
          Refresh owned chat status.
        </p>
      )}
      {owned.map((operation) => (
        <div key={operation.id}>
          <p>
            Chat: {operation.state}. Charged {operation.charged / 1_000_000}{" "}
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
              Cancel owned chat
            </Button>
          )}
        </div>
      ))}
      <Button onClick={() => void current.refetch()}>
        Refresh owned chats
      </Button>
      <section aria-label="Earlier account Pro chats">
        <p>Earlier account Pro chats have no recorded document identity.</p>
        {unscoped.isPending ? (
          <p>Checking earlier account chats...</p>
        ) : unscoped.isError ? (
          <p role="alert">
            Earlier account chats could not be read. Retry without starting new
            work.
          </p>
        ) : unscoped.data?.length === 0 ? (
          <p>No earlier account chat operation.</p>
        ) : null}
        {cancelUnscoped.isError && (
          <p role="alert">
            Account chat cancellation is not confirmed. Refresh status.
          </p>
        )}
        {unscoped.data
          ?.filter((operation) => operation.account_id === accountId)
          .map((operation) => (
            <div key={operation.id}>
              <p>
                Account chat: {operation.state}. Charged{" "}
                {operation.charged / 1_000_000} credits.
              </p>
              {operation.result && <p>{operation.result}</p>}
              {["reserved", "running", "unknown"].includes(operation.state) && (
                <Button
                  disabled={cancelUnscoped.isPending}
                  onClick={() =>
                    void cancelUnscoped
                      .mutateAsync({ id: operation.id })
                      .catch(() => {})
                  }
                >
                  Cancel account chat
                </Button>
              )}
            </div>
          ))}
        <Button onClick={() => void unscoped.refetch()}>
          Refresh account chats
        </Button>
      </section>
    </section>
  );
}
