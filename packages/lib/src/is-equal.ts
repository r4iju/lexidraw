export const isEqual = (first: unknown, second: unknown): boolean => {
  if (first === second) {
    return true;
  }
  if (
    (first === undefined ||
      second === undefined ||
      first === null ||
      second === null) &&
    (first || second)
  ) {
    return false;
  }
  const firstType = (first as { constructor?: { name?: string } })?.constructor
    ?.name;
  const secondType = (second as { constructor?: { name?: string } })
    ?.constructor?.name;
  if (firstType !== secondType) {
    return false;
  }
  if (firstType === "Array") {
    if (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length !== second.length
    ) {
      return false;
    }
    let equal = true;
    for (let i = 0; i < (first as unknown[]).length; i++) {
      if (!isEqual((first as unknown[])[i], (second as unknown[])[i])) {
        equal = false;
        break;
      }
    }
    return equal;
  }
  if (firstType === "Object") {
    let equal = true;
    const fKeys = Object.keys(first as Record<string, unknown>);
    const sKeys = Object.keys(second as Record<string, unknown>);
    if (fKeys.length !== sKeys.length) {
      return false;
    }
    for (const key of fKeys) {
      const fVal = (first as Record<string, unknown>)[key];
      const sVal = (second as Record<string, unknown>)[key];
      if (fVal && sVal) {
        if (fVal === sVal) {
          continue;
        }
        if (
          fVal &&
          ((fVal as { constructor?: { name?: string } })?.constructor?.name ===
            "Array" ||
            (fVal as { constructor?: { name?: string } })?.constructor?.name ===
              "Object")
        ) {
          equal = isEqual(fVal, sVal);
          if (!equal) {
            break;
          }
        } else if (fVal !== sVal) {
          equal = false;
          break;
        }
      } else if ((fVal && !sVal) || (!fVal && sVal)) {
        equal = false;
        break;
      }
    }
    return equal;
  }
  return first === second;
};
