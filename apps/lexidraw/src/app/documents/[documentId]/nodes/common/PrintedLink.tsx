/**
 * What an embed is on paper, where a player or a live frame cannot play: its
 * address. Shows only when printing; the embed itself is hidden there.
 */
export function PrintedLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="hidden print:inline text-primary underline break-all"
    >
      {href}
    </a>
  );
}
