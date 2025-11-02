"use client";

import { api } from "~/trpc/react";
import { useCallback } from "react";

export function useAutoSave() {
  const utils = api.useUtils();
  const { data, isLoading } = api.config.getAutoSaveConfig.useQuery();
  const { mutate: updateAutoSaveConfig } =
    api.config.updateAutoSaveConfig.useMutation({
      onSuccess: () => {
        utils.config.getAutoSaveConfig.invalidate();
      },
    });

  const enabled = data?.enabled ?? false;

  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      updateAutoSaveConfig({ enabled: newEnabled });
    },
    [updateAutoSaveConfig],
  );

  return {
    enabled: isLoading ? false : enabled,
    setEnabled,
    isLoading,
  };
}
