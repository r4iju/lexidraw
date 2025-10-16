import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";

export function useUserIdOrGuestId() {
  const generateGuestId = useCallback(() => {
    const existingId = localStorage.getItem("guestId");
    if (!existingId) {
      const array = new Uint32Array(8);
      window.crypto.getRandomValues(array);
      const newId = Array.from(array, (dec) =>
        `0${dec.toString(16)}`.substr(-2),
      ).join("");
      localStorage.setItem("guestId", newId);
      return newId;
    }
    return existingId;
  }, []);

  const { data: session } = useSession();

  const id = useMemo(() => {
    if (session?.user?.id) {
      return session.user.id;
    }
    return generateGuestId();
  }, [session?.user?.id, generateGuestId]);

  return id;
}
