import { UserIcon } from "lucide-react";
import Link from "next/link";
import { BuildingIcon } from "~/components/icons/building";
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
    <header className="sticky top-0 z-50 flex h-14 border-b border-gray-200 dark:border-gray-600 items-center justify-between bg-background py-2 px-4 shadow-md lg:px-6">
      <Link href="/" className="flex items-center justify-center">
        <BuildingIcon className="h-6 w-6" />
        <span className="sr-only">An Excalidraw Demo</span>
      </Link>
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
