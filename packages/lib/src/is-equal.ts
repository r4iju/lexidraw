// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isEqual = (first: any, second: any): boolean => {
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
  const firstType = first?.constructor.name;
  const secondType = second?.constructor.name;
  if (firstType !== secondType) {
    return false;
  }
  if (firstType === "Array") {
    if (first.length !== second.length) {
      return false;
    }
    let equal = true;
    for (let i = 0; i < first.length; i++) {
      if (!isEqual(first[i], second[i])) {
        equal = false;
        break;
      }
    }
    return equal;
  }
  if (firstType === "Object") {
    let equal = true;
    const fKeys = Object.keys(first);
    const sKeys = Object.keys(second);
    if (fKeys.length !== sKeys.length) {
      return false;
    }
    for (const key of fKeys) {
      if (first[key] && second[key]) {
        if (first[key] === second[key]) {
          continue;
        }
        if (
          first[key] &&
          (first[key].constructor.name === "Array" ||
            first[key].constructor.name === "Object")
        ) {
          equal = isEqual(first[key], second[key]);
          if (!equal) {
            break;
          }
        } else if (first[key] !== second[key]) {
          equal = false;
          break;
        }
      } else if ((first[key] && !second[key]) || (!first[key] && second[key])) {
        equal = false;
        break;
      }
    }
    return equal;
  }
  return first === second;
};
