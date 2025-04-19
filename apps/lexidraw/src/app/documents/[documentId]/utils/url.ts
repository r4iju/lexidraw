import { useCallback, useMemo } from "react";

export function useSanitizeUrl(): (url: string) => string {
  const SUPPORTED_URL_PROTOCOLS = useMemo(
    () => new Set(["http:", "https:", "mailto:", "sms:", "tel:"]),
    [],
  );

  const sanitizeUrl = useCallback(
    (url: string): string => {
      try {
        const parsedUrl = new URL(url);

        if (!SUPPORTED_URL_PROTOCOLS.has(parsedUrl.protocol)) {
          return "about:blank";
        }

        return parsedUrl.toString();
      } catch {
        return url;
      }
    },
    [SUPPORTED_URL_PROTOCOLS],
  );

  return sanitizeUrl;
}
