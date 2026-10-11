"use client";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useEntityId } from "~/hooks/use-entity-id";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import { api } from "~/trpc/react";
import { useSession } from "next-auth/react";
import {
  browserByok,
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
  const save = api.config.updateAutocompleteConfig.useMutation({
    onMutate: async (input) => {
      await utils.config.getAutocompleteConfig.cancel();
      if (!input.enabled)
        utils.config.getAutocompleteConfig.setData(undefined, input);
    },
    onSettled: () => utils.config.getAutocompleteConfig.invalidate(),
  });
  const account = useSession();
  const accountId =
    account.status === "authenticated" ? account.data.user.id : undefined;
  const session = browserByok(accountId);
  const generation = browserByokSessionGeneration();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const proForOwner = (): ProSuggestions => ({
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
  });
  const recovery = accountId
    ? suggestionRecovery(session, proForOwner())
    : undefined;
  const reference = useSyncExternalStore(
    session.subscribe,
    session.reference,
    () => undefined,
  );
  const [message, setMessage] = useState("");
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

  // Lexical owns caret changes, composition, request cancellation and suggestion painting.
  useEffect(() => {
    if (
      !accountId ||
      !enabled ||
      save.isPending ||
      save.error ||
      config.error ||
      power.error ||
      !preference ||
      unavailable ||
      (preference.mode === "byok" && !reference)
    )
      return;
    const source = createSuggestionSource(
      preference,
      session,
      proForOwner(),
      (state) => {
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
    return registerAutocomplete(editor, {
      title,
      entityId,
      delayMs: 600,
      suggest: async (input, signal) => {
        try {
          return await source(input, signal);
        } catch (error) {
          if (!signal.aborted)
            setMessage(
              error instanceof Error
                ? error.message
                : "Suggestion unavailable.",
            );
          throw error;
        }
      },
    });
  }, [
    editor,
    accountId,
    generation,
    origin,
    enabled,
    save.isPending,
    save.error,
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

  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
      contentEditable={false}
    >
      <Checkbox
        id="writing-suggestions"
        checked={enabled}
        disabled={config.isPending || save.isPending}
        onCheckedChange={(checked) =>
          save.mutate({ enabled: checked === true })
        }
      />
      <Label htmlFor="writing-suggestions">Writing suggestions</Label>
      <QueryNotice access={powerAccess} retry={() => void power.refetch()} />
      <QueryNotice access={configAccess} retry={() => void config.refetch()} />
      <QueryNotice access={access} retry={() => void allowance.refetch()} />
      <span role="status">
        {powerAccess.kind !== "ready" || configAccess.kind !== "ready"
          ? "Suggestions paused until settings are available."
          : save.error
            ? "Suggestions unavailable. Check AI Power."
            : !enabled
              ? "Off · opt in to use your AI power source"
              : unavailable || message || "On · accept with Tab"}
      </span>
      {accountId && recovery?.pending && (
        <>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
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
            Refresh owned suggestion
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
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
            Cancel owned suggestion
          </Button>
        </>
      )}
      {enabled && preference?.mode === "pro" && allowance.data && (
        <span>
          {(allowance.data.availableSubcredits / 1_000_000).toFixed(3)} credits
          available ·{" "}
          {(allowance.data.reservedSubcredits / 1_000_000).toFixed(3)} reserved
          ·{" "}
          {(
            allowance.data.history
              .filter((item) => item.feature === "autocomplete")
              .reduce((sum, item) => sum + item.charged, 0) / 1_000_000
          ).toFixed(3)}{" "}
          suggestion credits in recent usage
        </span>
      )}
    </div>
  );
}
