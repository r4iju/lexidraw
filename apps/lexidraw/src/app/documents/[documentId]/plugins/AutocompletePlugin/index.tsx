"use client";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { CircleAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useEntityId } from "~/hooks/use-entity-id";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import { api } from "~/trpc/react";
import { useSession } from "next-auth/react";
import {
  useBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
} from "~/lib/byok/browser-session";
import { registerAutocomplete } from "./register";
import {
  createSuggestionSource,
  suggestionRecovery,
  refreshOwnedSuggestion,
  type ProSuggestions,
} from "./stream-suggestion";

export default function AutocompletePlugin({ title = "" }: { title?: string }) {
  const [editor] = useLexicalComposerContext();
  const entityId = useEntityId();
  const utils = api.useUtils();
  const config = api.config.getAutocompleteConfig.useQuery();
  const power = api.auth.getPowerPreference.useQuery();
  const allowance = api.pro.status.useQuery(undefined, {
    enabled: power.data?.mode === "pro",
    refetchInterval: 5000,
  });
  const account = useSession();
  const accountId =
    account.status === "authenticated" ? account.data.user.id : undefined;
  const session = useBrowserByok(accountId);
  const generation = browserByokSessionGeneration();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const proForOwner = useCallback(
    (): ProSuggestions => ({
      start: (input) => utils.client.pro.autocomplete.mutate(input),
      recover: (input) => utils.client.pro.autocompleteRecovery.query(input),
      read: (id) => utils.client.pro.operation.query({ id }),
      cancel: (id) => utils.client.pro.cancel.mutate({ id }),
      owner: {
        id: JSON.stringify([origin, accountId, generation]),
        current: () =>
          !!accountId &&
          browserByokAccount() === accountId &&
          browserByokSessionGeneration() === generation &&
          window.location.origin === origin,
      },
    }),
    [utils, accountId, generation, origin],
  );
  const recovery =
    accountId && session
      ? suggestionRecovery(session, proForOwner())
      : undefined;
  const reference = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    session?.reference ?? (() => undefined),
    () => undefined,
  );
  const enabled = config.data?.enabled === true;
  const powerAccess = queryAccess(power, true, "AI power preference");
  const configAccess = queryAccess(config, true, "Suggestion settings");
  const preference =
    powerAccess.kind === "ready" ? powerAccess.data : undefined;
  const access = queryAccess(
    allowance,
    preference?.mode === "pro",
    "Pro suggestion allowance",
  );
  const unavailable =
    access.kind === "error" || access.kind === "loading"
      ? access.message
      : preference?.mode === "local"
        ? "Local suggestions are unavailable in this browser."
        : preference?.mode === "byok" && !reference
          ? "Set up your key on this device in AI Power."
          : preference?.mode === "pro" && !allowance.data?.entitled
            ? "Pro Coming soon. Private allowance required."
            : preference?.mode === "pro" &&
                allowance.data &&
                allowance.data.availableSubcredits < 1_120_000
              ? "Not enough allowance for another suggestion. Check AI Power."
              : "";

  const provider =
    preference?.mode === "byok" ? preference.provider : undefined;
  const registrationScope = useMemo(
    () => ({
      editor,
      entityId,
      title,
      accountId,
      generation,
      session,
      source: preference?.mode,
      provider,
      reference,
    }),
    [
      editor,
      entityId,
      title,
      accountId,
      generation,
      session,
      preference?.mode,
      provider,
      reference,
    ],
  );
  const recoveryScope = useMemo(
    () => ({ accountId, generation, session }),
    [accountId, generation, session],
  );
  const [notice, setNotice] = useState<{
    scope: typeof registrationScope;
    message: string;
  } | null>(null);
  const [ownedNotice, setOwnedNotice] = useState<{
    scope: typeof recoveryScope;
    message: string;
  } | null>(null);
  const message = notice?.scope === registrationScope ? notice.message : "";
  const ownedMessage =
    ownedNotice?.scope === recoveryScope ? ownedNotice.message : "";

  const recoveryMessage =
    ownedMessage ||
    (recovery?.pending
      ? recovery.pending.kind === "acceptanceUncertain"
        ? "Owned suggestion acceptance is unconfirmed. Refresh its original request."
        : "An owned suggestion requires reconciliation; credits may remain reserved. Refresh or cancel its original request."
      : "");

  // Lexical owns caret changes, composition, request cancellation and suggestion painting.
  useEffect(() => {
    if (
      !accountId ||
      !session ||
      !enabled ||
      config.error ||
      power.error ||
      !preference ||
      unavailable ||
      (preference.mode === "byok" && !reference)
    )
      return;
    let disposed = false;
    const setMessage = (message: string) => {
      if (!disposed) setNotice({ scope: registrationScope, message });
    };
    const source = createSuggestionSource(
      preference,
      session,
      proForOwner(),
      (state) => {
        if (disposed) return;
        setMessage(
          state === "acceptanceUncertain"
            ? "Suggestion acceptance is unconfirmed. Refresh the original request before another paid suggestion."
            : state === "cancellationUnconfirmed"
              ? "Cancellation is unconfirmed. Refresh owned suggestion status."
              : state === "unknown"
                ? "A suggestion is reconciling; credits remain reserved."
                : "",
        );
        void utils.pro.status.invalidate();
      },
    );
    const unregister = registerAutocomplete(editor, {
      title,
      entityId,
      delayMs: 600,
      suggest: async (input, signal) => {
        try {
          return await source(input, signal);
        } catch (error) {
          if (!disposed && !signal.aborted)
            setMessage(
              error instanceof Error
                ? error.message
                : "Suggestion unavailable.",
            );
          throw error;
        }
      },
    });
    return () => {
      disposed = true;
      unregister();
    };
  }, [
    registrationScope,
    editor,
    accountId,
    proForOwner,
    enabled,
    config.error,
    power.error,
    preference,
    unavailable,
    session,
    reference,
    title,
    entityId,
    utils,
  ]);

  const needsAttention = !!(
    recovery?.pending ||
    message ||
    (enabled && unavailable) ||
    config.error ||
    power.error
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label="Writing suggestions"
          aria-description={needsAttention ? "Needs attention" : undefined}
          title={
            needsAttention
              ? "Writing suggestions need attention"
              : "Writing suggestions"
          }
        >
          {needsAttention ? (
            <CircleAlert aria-hidden="true" className="size-4 text-warning" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Writing suggestions"
        className="space-y-3 text-sm break-words"
      >
        <p className="font-medium">Writing suggestions</p>
        <QueryNotice access={powerAccess} retry={() => void power.refetch()} />
        <QueryNotice
          access={configAccess}
          retry={() => void config.refetch()}
        />
        <QueryNotice access={access} retry={() => void allowance.refetch()} />
        <p role="status">
          {powerAccess.kind !== "ready" || configAccess.kind !== "ready"
            ? "Suggestions paused until settings are available."
            : !enabled
              ? "Off · opt in to use your AI power source"
              : unavailable || message || "On · accept with Tab"}
        </p>
        {recoveryMessage && <p role="status">{recoveryMessage}</p>}
        {accountId && recovery?.pending && (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                if (!session) return;
                const setMessage = (message: string) =>
                  setOwnedNotice({ scope: recoveryScope, message });
                void refreshOwnedSuggestion(session, proForOwner())
                  .then((operation) => {
                    setMessage(
                      operation?.state === "unknown"
                        ? "A suggestion is reconciling; credits remain reserved."
                        : "Owned suggestion status refreshed.",
                    );
                    void utils.pro.status.invalidate();
                  })
                  .catch(() =>
                    setMessage(
                      "Suggestion acceptance or status is still unconfirmed. Retry the owned read.",
                    ),
                  );
              }}
            >
              Refresh suggestion status
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                if (!session) return;
                const setMessage = (message: string) =>
                  setOwnedNotice({ scope: recoveryScope, message });
                void refreshOwnedSuggestion(session, proForOwner(), true)
                  .then((operation) => {
                    setMessage(
                      operation &&
                        ["reserved", "running", "unknown"].includes(
                          operation.state,
                        )
                        ? "Cancellation is unconfirmed; credits remain reserved."
                        : "Suggestion stopped.",
                    );
                    void utils.pro.status.invalidate();
                  })
                  .catch(() =>
                    setMessage(
                      "Cancellation is unconfirmed. Retry the owned read or cancellation.",
                    ),
                  );
              }}
            >
              Cancel suggestion
            </Button>
          </div>
        )}
        <Link
          href="/settings#settings-ai"
          className="block text-primary underline underline-offset-4"
        >
          Manage suggestions and AI Power
        </Link>
      </PopoverContent>
    </Popover>
  );
}
