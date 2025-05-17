import { useSession } from "next-auth/react";
import { useMemo } from "react";

export function useUserNameOrGuestName() {
  const generateGuestName = () => {
    const existingName = localStorage.getItem("guestName");
    if (!existingName) {
      const array = new Uint32Array(8);
      window.crypto.getRandomValues(array);
      const newName = "Guest";
      localStorage.setItem("guestName", newName);
      return newName;
    }
    return existingName;
  };

  const { data: session } = useSession();

  const name = useMemo(() => {
    if (session?.user?.name) {
      return session.user.name;
    }
    return generateGuestName();
  }, [session?.user?.name]);

  return name;
}
