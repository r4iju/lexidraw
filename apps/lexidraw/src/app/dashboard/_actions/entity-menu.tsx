"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  HeartIcon,
  HeartOffIcon,
  ImageIcon,
  LinkIcon,
  PencilIcon,
  ShareIcon,
  TagIcon,
  TrashIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { type EntityAccess, may } from "~/lib/entity-access";

type Props = {
  title: string;
  /** Where the file opens. */
  href: string;
  /** The viewer's access, which decides what the menu offers them. */
  access: EntityAccess;
  favorited: boolean;
  archived: boolean;
  onShare: () => void;
  onCopyLink: () => void;
  onRename: () => void;
  onTags: () => void;
  onThumbnail: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
};

/**
 * A file's ⋯ menu: opening and sharing it, then organising it, then putting
 * it away, and deleting it last, set apart. It offers only what `access`
 * allows, by the rule the server holds each action to.
 */
export function EntityMenu({
  title,
  href,
  access,
  favorited,
  archived,
  onShare,
  onCopyLink,
  onRename,
  onTags,
  onThumbnail,
  onToggleFavorite,
  onToggleArchive,
  onDelete,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`More actions for ${title}`}
        >
          <EllipsisIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 [&_svg]:size-4 [&_svg]:shrink-0 [&_[role=menuitem]]:gap-2.5"
      >
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={href} target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden="true" />
              Open in new tab
            </a>
          </DropdownMenuItem>
          {may(access, "share") && (
            <DropdownMenuItem onSelect={onShare}>
              <ShareIcon aria-hidden="true" />
              Share…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onCopyLink}>
            <LinkIcon aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {may(access, "rename") && (
            <DropdownMenuItem onSelect={onRename}>
              <PencilIcon aria-hidden="true" />
              Rename…
            </DropdownMenuItem>
          )}
          {may(access, "tags") && (
            <DropdownMenuItem onSelect={onTags}>
              <TagIcon aria-hidden="true" />
              Tags…
            </DropdownMenuItem>
          )}
          {may(access, "thumbnail") && (
            <DropdownMenuItem onSelect={onThumbnail}>
              <ImageIcon aria-hidden="true" />
              Change thumbnail…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onToggleFavorite}>
            {favorited ? (
              <HeartOffIcon aria-hidden="true" />
            ) : (
              <HeartIcon aria-hidden="true" />
            )}
            {favorited ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onToggleArchive}>
          {archived ? (
            <ArchiveRestoreIcon aria-hidden="true" />
          ) : (
            <ArchiveIcon aria-hidden="true" />
          )}
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
        {may(access, "delete") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon aria-hidden="true" />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
