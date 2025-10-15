import { useCallback } from "react";

export const useRoundUtils = () => {
  const round = useCallback(
    (number: number, digits = 0, base = 10 ** digits): number => {
      return Math.round(base * number) / base;
    },
    [],
  );

  return { round };
};
