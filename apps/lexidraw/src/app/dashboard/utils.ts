type Props = {
  pathname: string;
  prevParams: URLSearchParams;
  key: string;
  value: string;
};

export const replaceSearchParam = ({
  pathname,
  prevParams,
  key,
  value,
}: Props) => {
  const newParams = new URLSearchParams(prevParams);
  newParams.set(key, value);
  return `${pathname}?${newParams.toString()}`;
};
