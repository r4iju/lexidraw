import { UserIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AppIcon } from "~/components/icons/app";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { auth } from "~/server/auth";
import { isAdmin } from "~/server/admin";
import { HeaderAdminIconButton } from "./header-admin-icon-button";
import { SessionedDropdown, UnsessionedDropdown } from "./profile-dropdown";

async function HeaderContent() {
  const session = await auth();
  const userIsAdmin = await isAdmin();

  return (
    <header className="sticky top-0 left-0 w-full min-w-[100dw] min-h-[var(--header-height)] z-50 flex border-b border-muted items-center justify-between bg-background shadow-md pt-[var(--header-padding-top)] pb-[var(--header-py)] px-4 lg:px-6 overflow-hidden">
      <Button asChild variant="outline" size="icon">
        <Link href="/">
          <AppIcon
            className="size-full object-contain border-muted hover:shadow-xs"
            aria-label="Go to startpage"
          />
        </Link>
      </Button>

      <nav>
        <ul className="flex items-center gap-4 sm:gap-6">
          {userIsAdmin && <HeaderAdminIconButton />}
          <li>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <UserIcon className="h-[1.2rem] w-[1.2rem]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {session && <SessionedDropdown />}
                {!session && <UnsessionedDropdown />}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
          <li className="flex items-center">
            <ModeToggle />
          </li>
        </ul>
      </nav>
    </header>
  );
}

export default function Header() {
  return (
    <Suspense
      fallback={
        <header className="sticky top-0 left-0 w-full min-w-[100dw] min-h-[var(--header-height)] z-50 flex border-b border-muted items-center justify-between bg-background shadow-md pt-[var(--header-padding-top)] pb-[var(--header-py)] px-4 lg:px-6 overflow-hidden">
          <Button asChild variant="outline" size="icon">
            <Link href="/">
              <AppIcon
                className="size-full object-contain border-muted hover:shadow-xs"
                aria-label="Go to startpage"
              />
            </Link>
          </Button>
          <nav>
            <ul className="flex items-center gap-4 sm:gap-6">
              <li>
                <Button variant="outline" size="icon" disabled>
                  <UserIcon className="h-[1.2rem] w-[1.2rem]" />
                </Button>
              </li>
              <li className="flex items-center">
                <ModeToggle />
              </li>
            </ul>
          </nav>
        </header>
      }
    >
      <HeaderContent />
    </Suspense>
  );
}
