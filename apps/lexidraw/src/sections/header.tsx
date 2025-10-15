import { UserIcon } from "lucide-react";
import Link from "next/link";
import { AppIcon } from "~/components/icons/app";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { auth } from "~/server/auth";

export default async function Header() {
  const session = await auth();
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
          <li>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <UserIcon className="h-[1.2rem] w-[1.2rem]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {session && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link className="cursor-default" href="/dashboard">
                        My Drawings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link className="cursor-default" href="/profile">
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        className="cursor-default"
                        href="/api/auth/signout?callbackUrl=/api/auth/session"
                      >
                        Sign out
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                {!session && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link className="cursor-default" href="/signin">
                        Sign in
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link className="cursor-default" href="/signup">
                        Create account
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
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
