import type { SettingName } from "./app-settings";

import * as React from "react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { DEFAULT_SETTINGS, INITIAL_SETTINGS } from "./app-settings";

type SettingsContextShape = {
  setOption: (name: SettingName, value: boolean) => void;
  settings: Record<SettingName, boolean>;
};

const Context: React.Context<SettingsContextShape> = createContext({
  setOption: (_name: SettingName, _value: boolean) => {
    return;
  },
  settings: INITIAL_SETTINGS,
});

export const SettingsContext = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);

  const setURLParam = (param: SettingName, value: null | boolean) => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    if (value !== DEFAULT_SETTINGS[param]) {
      params.set(param, String(value));
    } else {
      params.delete(param);
    }
    url.search = params.toString();
    window.history.pushState(null, "", url.toString());
  };

  const setOption = useCallback((setting: SettingName, value: boolean) => {
    setSettings((options) => ({
      ...options,
      [setting]: value,
    }));
    setURLParam(setting, value);
  }, []);

  const contextValue = useMemo(() => {
    return { setOption, settings };
  }, [setOption, settings]);

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useSettings = (): SettingsContextShape => {
  return useContext(Context);
};
