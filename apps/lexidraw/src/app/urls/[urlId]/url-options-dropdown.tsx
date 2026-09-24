"use client";

import { MenuIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useState } from "react";
import RenameEntityModal from "~/app/dashboard/_actions/rename-modal";
import DeleteEntityModal from "~/app/dashboard/_actions/delete-entity";
import TagEntityModal from "~/app/dashboard/_actions/tag-modal";
import type { RouterOutputs } from "~/trpc/shared";
import { api } from "~/trpc/react";
import Link from "next/link";
import { revalidateUrl } from "./actions";
import { useRouter } from "next/navigation";

type Props = {
  className?: string;
  entity: Pick<
    RouterOutputs["entities"]["load"],
    "id" | "title" | "accessLevel"
  >;
  onChangeUrl: () => void;
};

export default function UrlOptionsDropdown({
  className,
  entity,
  onChangeUrl,
}: Props) {
  const router = useRouter();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isTagOpen, setIsTagOpen] = useState(false);
  const { mutate: refresh, isPending } = api.entities.distillUrl.useMutation({
    onSuccess: async () => {
      toast.success(`Refreshed the text of “${entity.title}”.`);
      await revalidateUrl(entity.id);
    },
    onError: (error) =>
      toast.error("Couldn’t read the page. Try again.", {
        description: error.message,
      }),
  });

  const handleRefresh = () => {
    refresh({ id: entity.id });
  };

  const handleTagSuccess = async () => {
    await revalidateUrl(entity.id);
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={className} variant="outline" size="icon">
          <MenuIcon />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup title="App">
          <DropdownMenuItem asChild>
            <Link href="/dashboard">Back to Home</Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup title="Link">
          <DropdownMenuItem onClick={handleRefresh} disabled={isPending}>
            {isPending ? (
              <LoaderCircleIcon className="mr-2 inline-block animate-spin" />
            ) : (
              <RefreshCwIcon className="mr-2 inline-block" />
            )}{" "}
            Refresh text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsRenameOpen(true)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsTagOpen(true)}>
            Edit tags…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsDeleteOpen(true)}>
            Delete…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onChangeUrl}>
            Change link…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      <RenameEntityModal
        entity={{ id: entity.id, title: entity.title }}
        isOpen={isRenameOpen}
        onOpenChange={setIsRenameOpen}
      />
      <DeleteEntityModal
        entity={{ id: entity.id, entityType: "url", title: entity.title }}
        isOpen={isDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setIsDeleteOpen(false);
        }}
      />
      <TagEntityModal
        entity={{ id: entity.id }}
        isOpen={isTagOpen}
        onOpenChange={setIsTagOpen}
        onSuccess={handleTagSuccess}
      />
    </DropdownMenu>
  );
}
