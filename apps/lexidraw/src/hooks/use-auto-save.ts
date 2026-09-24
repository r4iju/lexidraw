"use client";

import { api } from "~/trpc/react";
import { useCallback } from "react";
import { autoSaveEnabled } from "~/lib/auto-save";

export function useAutoSave(options?: { enabled?: boolean }) {
  const queryEnabled = options?.enabled ?? true;
  const utils = api.useUtils();
  const { data, isLoading } = api.config.getAutoSaveConfig.useQuery(undefined, {
    enabled: queryEnabled,
  });
  const { mutate: updateAutoSaveConfig } =
    api.config.updateAutoSaveConfig.useMutation({
      // Optimistic update to prevent UI flicker
      onMutate: async (vars) => {
        await utils.config.getAutoSaveConfig.cancel();
        const previous = utils.config.getAutoSaveConfig.getData();
        utils.config.getAutoSaveConfig.setData(undefined, {
          enabled: vars.enabled,
        });
        return { previous } as { previous?: { enabled: boolean } };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) {
          utils.config.getAutoSaveConfig.setData(undefined, ctx.previous);
        }
      },
      onSettled: () => {
        utils.config.getAutoSaveConfig.invalidate();
      },
    });

  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      if (!queryEnabled) return;
      updateAutoSaveConfig({ enabled: newEnabled });
    },
    [updateAutoSaveConfig, queryEnabled],
  );

  return {
    // Unknown until it loads, and a save the user turned off is not undone.
    enabled: isLoading ? false : autoSaveEnabled(data),
    setEnabled,
    isLoading,
  };
}
