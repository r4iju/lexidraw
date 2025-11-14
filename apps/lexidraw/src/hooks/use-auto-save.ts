"use client";

import { api } from "~/trpc/react";
import { useCallback } from "react";

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

  const enabled = data?.enabled ?? false;

  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      if (!queryEnabled) return;
      updateAutoSaveConfig({ enabled: newEnabled });
    },
    [updateAutoSaveConfig, queryEnabled],
  );

  return {
    enabled: isLoading ? false : enabled,
    setEnabled,
    isLoading,
  };
}
