export default function joinClasses(
  ...args: (string | boolean | null | undefined)[]
) {
  return args.filter(Boolean).join(" ");
}
