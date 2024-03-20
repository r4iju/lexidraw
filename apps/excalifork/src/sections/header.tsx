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
                    <Link className="cursor-default" href="/dashboard">
                      <DropdownMenuItem>My drawings</DropdownMenuItem>
                    </Link>
                    <DropdownMenuSeparator />
                    <Link className="cursor-default" href="/profile">
                      <DropdownMenuItem>Profile</DropdownMenuItem>
                    </Link>
                    <Link
                      className="cursor-default"
                      href="/api/auth/signout?callbackUrl=/api/auth/session"
                    >
                      <DropdownMenuItem>Sign out</DropdownMenuItem>
                    </Link>
                  </>
                )}
                {!session && (
                  <>
                    <Link className="cursor-default" href="/auth/signin">
                      <DropdownMenuItem>Sign in</DropdownMenuItem>
                    </Link>
                    <Link className="cursor-default" href="/auth/signup">
                      <DropdownMenuItem>Create account</DropdownMenuItem>
                    </Link>
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
