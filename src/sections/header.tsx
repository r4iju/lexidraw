import Link from "next/link";
import { BuildingIcon } from "~/components/icons/building";
import ModeToggle from "~/components/theme/dark-mode-toggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between bg-background px-4 shadow-md lg:px-6">
      <Link href="/" className="flex items-center justify-center">
        <BuildingIcon className="h-6 w-6" />
        <span className="sr-only">An Excalidraw Demo</span>
      </Link>
      <nav>
        <ul className="flex items-center gap-4 sm:gap-6">
          <li>
            <Link
              className="text-sm font-medium underline-offset-4 hover:underline"
              href="/dashboard"
            >
              My drawings
            </Link>
          </li>
          <li className="flex items-center">
            <ModeToggle />
          </li>
        </ul>
      </nav>
    </header>
  );
}
