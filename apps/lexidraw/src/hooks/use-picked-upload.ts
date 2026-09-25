import { useRef, useState } from "react";
import type { Upload } from "~/lib/media-upload";

type Picked = { pending: true } | { pending: false; src: string };

/**
 * A file input's upload through `upload`: pending while the file goes up,
 * then its address, or "" when it failed (which `upload` has said why).
 * Only the latest pick counts, so a slower earlier one never replaces it.
 */
export function usePickedUpload(upload: Upload) {
  const [picked, setPicked] = useState<Picked>({ pending: false, src: "" });
  const latest = useRef(0);
  const pick = (files: ArrayLike<File> | null) => {
    const file = files?.[0];
    if (!file) return;
    const pickNumber = ++latest.current;
    setPicked({ pending: true });
    void upload(file).then((url) => {
      if (pickNumber === latest.current)
        setPicked({ pending: false, src: url ?? "" });
    });
  };
  return {
    src: picked.pending ? "" : picked.src,
    pending: picked.pending,
    pick,
  };
}
