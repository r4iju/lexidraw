import { useSession } from 'next-auth/react';
import { useMemo } from 'react';
import { generateGuestId } from '~/lib/generate-guest-id';

export function useUserIdOrGuestId() {
  const { data: session } = useSession();

  const id = useMemo(() => {
    if (session?.user?.id) {
      return session.user.id;
    }
    return generateGuestId();
  }, [session?.user?.id]);

  return id;
}
