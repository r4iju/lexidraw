import { PublicAccess } from "@packages/types";
import { toast } from "sonner";
import { entityHref } from "~/lib/entity-types";

type Linkable = { id: string; title: string; entityType: string };

/** Copies the address of a file or folder, and says who that link opens it for. */
export async function copyEntityLink(
  entity: Linkable,
  publicAccess: PublicAccess,
) {
  const url = `${window.location.origin}${entityHref(entity.entityType, entity.id)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success(
      `Copied the link to “${entity.title}”.`,
      publicAccess === PublicAccess.PRIVATE
        ? { description: "Only people you’ve shared it with can open it." }
        : undefined,
    );
  } catch {
    toast.error("Couldn’t copy the link. Try again.");
  }
}
