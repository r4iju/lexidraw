import type { SettingName } from "./app-settings";

import * as React from "react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DEFAULT_SETTINGS } from "./app-settings";

const SETTINGS_STORAGE_KEY = "lexidraw-settings";

type SettingsContextShape = {
  setOption: (name: SettingName, value: boolean) => void;
  settings: Record<SettingName, boolean>;
};

const Context: React.Context<SettingsContextShape> = createContext({
  setOption: (_name: SettingName, _value: boolean) => {
    return;
  },
  settings: DEFAULT_SETTINGS,
});

export const SettingsContext = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const storedSettings =
          window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (storedSettings) {
          const parsedSettings = JSON.parse(storedSettings);
          const mergedSettings = { ...DEFAULT_SETTINGS };
          for (const key in parsedSettings) {
            if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
              mergedSettings[key as SettingName] = parsedSettings[key];
            }
          }
          return mergedSettings;
        }
      } catch (error) {
        console.error("Error loading settings from localStorage:", error);
      }
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(settings),
        );
      } catch (error) {
        console.error("Error saving settings to localStorage:", error);
      }
    }
  }, [settings]);

  const setOption = useCallback((setting: SettingName, value: boolean) => {
    setSettings((options) => {
      const newOptions = {
        ...options,
        [setting]: value,
      };
      return newOptions;
    });
  }, []);

  const contextValue = useMemo(() => {
    return { setOption, settings };
  }, [setOption, settings]);

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useSettings = (): SettingsContextShape => {
  return useContext(Context);
};
