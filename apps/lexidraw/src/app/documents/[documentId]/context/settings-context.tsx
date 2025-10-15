import type { SettingName } from "./app-settings";

import type * as React from "react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DEFAULT_SETTINGS, type Settings } from "./app-settings";

const SETTINGS_STORAGE_KEY = "lexidraw-settings";

/* ⬇︎ Create the bare context WITHOUT a default value.
   (That way we cannot accidentally read from it before a provider exists.) */
type SettingsContextShape = {
  settings: Settings;
  setOption: (name: SettingName, value: boolean) => void;
};
const SettingsContext = createContext<SettingsContextShape | undefined>(
  undefined,
);

export const SettingsProvider = ({
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
            if (Object.hasOwn(DEFAULT_SETTINGS, key)) {
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

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextShape => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsContext");
  }
  return context;
};
