/** The app bar's gutter, so a page's title and files line up under Home. */
export const GUTTER = "w-full px-4 sm:px-6 lg:px-8";

type Props = {
  pathname: string;
  prevParams: URLSearchParams;
  key: string;
  value?: string | null;
};

export const replaceSearchParam = ({
  pathname,
  prevParams,
  key,
  value,
}: Props) => {
  const newParams = new URLSearchParams(prevParams);
  if (value == null || value === "") {
    newParams.delete(key);
  } else {
    newParams.set(key, value);
  }
  const qs = newParams.toString();
  return qs ? `${pathname}?${qs}` : pathname;
};
