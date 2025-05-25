import { useCallback } from "react";

export const useClampUtils = () => {
  // Clamps a value between an upper and lower bound.
  // We use ternary operators because it makes the minified code
  // 2 times shorter then `Math.min(Math.max(a,b),c)`
  const clamp = useCallback((number: number, min = 0, max = 1): number => {
    return number > max ? max : number < min ? min : number;
  }, []);

  return { clamp };
};
